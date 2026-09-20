from __future__ import annotations

import os
import time
import uuid
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from agentic.core import MODEL, call_json, call_text, merge_usage

router = APIRouter(prefix="/api/ach-ai", tags=["ach-ai"])

TEAM = [
    ("ACH Operations Lead", "Orchestrator", "Synthesize the operating picture and choose the safest next step."),
    ("Nacha Specialist", "File & batch validation", "Assess ACH file, batch, entry, SEC, trace, control-total, routing, and preflight issues."),
    ("Returns Specialist", "Nacha returns", "Interpret return codes and distinguish payment outcome from operational resolution."),
    ("Account & Authorization Specialist", "Account & authorization", "Assess account state, funds, stop-payment, authorization, and receiver conditions."),
    ("Processor & Connectivity Specialist", "Processor & network", "Assess acknowledgements, timeouts, retries, queues, ODFI/operator connectivity, and duplicate risk."),
    ("Posting & Core Specialist", "Posting & core", "Assess downstream posting state and whether replay/retry could duplicate a payment."),
    ("Reconciliation Specialist", "Settlement & reconciliation", "Assess expected-vs-posted amounts, settlement state, and unmatched ledger activity."),
    ("Risk & Controls Specialist", "Risk & controls", "Assess auditability, human approval, idempotency, fraud/compliance holds, and safe containment."),
]

class ACHChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    scenario: str = Field(default="healthy", max_length=30)
    transaction_id: str | None = Field(default=None, max_length=120)
    screen_context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)

class ACHTeamRequest(BaseModel):
    scenario: str = Field(default="healthy", max_length=30)
    transaction_id: str | None = Field(default=None, max_length=120)
    question: str = Field(default="Analyze the current ACH operating condition and recommend the safest next action.", max_length=4000)
    screen_context: dict[str, Any] = Field(default_factory=dict)

def _db() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is not configured")
    return value

def _jsonable(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out = {}
    for k, v in dict(row).items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif hasattr(v, "as_tuple"):
            out[k] = float(v)
        else:
            out[k] = v
    return out

def load_context(scenario: str, transaction_id: str | None) -> dict[str, Any]:
    context: dict[str, Any] = {
        "rail": "ACH",
        "scenario": scenario,
        "transaction": None,
        "events": [],
        "scenario_snapshot": None,
        "recent_preflight": None,
        "return_catalog_sample": [],
        "open_failure_cases": [],
    }
    with psycopg.connect(_db(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM operations_scenario_snapshots WHERE scenario=%s", (scenario,))
            context["scenario_snapshot"] = _jsonable(cur.fetchone())

            tx_id = transaction_id
            if not tx_id and context["scenario_snapshot"]:
                tx_id = context["scenario_snapshot"].get("example_transaction_id")

            if tx_id:
                cur.execute(
                    """SELECT t.*, cu.name AS credit_union_name,
                              f.file_id AS ach_file_identifier, b.batch_number, b.sec_code
                       FROM ach_transactions t
                       LEFT JOIN operations_credit_unions cu ON cu.id=t.credit_union_id
                       LEFT JOIN ach_files f ON f.id=t.file_id
                       LEFT JOIN ach_batches b ON b.id=t.batch_id
                       WHERE t.id=%s""",
                    (tx_id,),
                )
                context["transaction"] = _jsonable(cur.fetchone())
                cur.execute(
                    """SELECT sequence,stage,status,event_time,source_system,correlation_id,
                              response_code,message
                       FROM ach_transaction_events
                       WHERE transaction_id=%s ORDER BY sequence""",
                    (tx_id,),
                )
                context["events"] = [_jsonable(r) for r in cur.fetchall()]

            cur.execute(
                """SELECT id,filename,passed,error_count,warning_count,created_at
                   FROM ach_preflight_runs ORDER BY created_at DESC LIMIT 1"""
            )
            context["recent_preflight"] = _jsonable(cur.fetchone())

            cur.execute(
                """SELECT code,title,category,active_2026
                   FROM ach_return_code_catalog
                   WHERE active_2026=true ORDER BY code LIMIT 12"""
            )
            context["return_catalog_sample"] = [_jsonable(r) for r in cur.fetchall()]

            cur.execute(
                """SELECT id,category,subtype,case_name,expected_resolution,case_status
                   FROM ach_preflight_cases
                   WHERE case_status='OPEN'
                   ORDER BY category,id LIMIT 30"""
            )
            preflight_cases = [_jsonable(r) for r in cur.fetchall()]
            cur.execute(
                """SELECT f.id,
                          c.category,
                          f.return_code AS subtype,
                          f.case_name,
                          COALESCE(f.notes, 'Review the return reason and complete the documented ACH remediation workflow.') AS expected_resolution,
                          f.case_status,
                          f.operational_state,
                          f.payment_outcome,
                          f.remediation_state
                   FROM ach_failure_cases f
                   JOIN ach_return_code_catalog c ON c.code=f.return_code
                   WHERE f.case_status='OPEN'
                   ORDER BY f.return_code
                   LIMIT 80"""
            )
            return_cases = [_jsonable(r) for r in cur.fetchall()]
            context["open_failure_cases"] = [*preflight_cases, *return_cases]
    return context

def _context_text(context: dict[str, Any], screen_context: dict[str, Any]) -> str:
    import json
    return json.dumps({"database_context": context, "screen_context": screen_context}, indent=2, default=str)

@router.post("/chat")
def ach_chat(payload: ACHChatRequest) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")
    started = time.perf_counter()
    try:
        context = load_context(payload.scenario, payload.transaction_id)
        history = "\n".join(
            f"{item.get('role','user').upper()}: {item.get('content','')}"
            for item in payload.history[-8:]
        )
        system = """You are ACH Ops Copilot, the operator-facing assistant for a regulated ACH payments operations workspace.
Use the supplied database/screen context as the source of truth. The screen_context may include visibleTransaction, which is the transaction currently displayed to the operator even when the database snapshot is unavailable. Treat it as valid UI evidence and clearly distinguish known fields from unknown downstream fields. Never say no transaction is visible when visibleTransaction is present.
Do not invent downstream acknowledgements, account status, network outcomes, incident status, or resolution state.
ABSENCE OF EVIDENCE IS UNKNOWN, NOT RESOLVED: missing failure-case rows, missing events, or unavailable database records must never be used as proof that an incident is resolved or that a payment succeeded.
For retry/requeue questions, explicitly check whether downstream acceptance/posting is known before recommending replay because duplicate-payment risk matters.
Distinguish PAYMENT OUTCOME from OPERATIONS STATUS. A returned payment can be operationally resolved without becoming successful, but a missing operations status remains UNKNOWN.
If a consequential action is proposed, state that human approval is required.
If material or systemic impact warrants incident escalation, route the handoff to Incident Intelligence / Lindsay, the Incident Commander.
If the question needs deeper specialist analysis, recommend "Run AI Team Analysis."
Keep responses concise, operational, and teach the operator what signal caused the conclusion."""
        user = f"""CURRENT ACH CONTEXT
{_context_text(context, payload.screen_context)}

RECENT CHAT
{history or "(none)"}

OPERATOR QUESTION
{payload.message}
"""
        answer, usage = call_text(system, user)
        return {
            "run_id": f"achchat_{uuid.uuid4().hex[:12]}",
            "model": MODEL,
            "answer": answer,
            "context": {"scenario": payload.scenario, "transaction_id": (context.get("transaction") or {}).get("id")},
            "token_usage": usage,
            "latency_ms": round((time.perf_counter()-started)*1000),
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.post("/team")
def ach_team(payload: ACHTeamRequest) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")
    started = time.perf_counter()
    try:
        context = load_context(payload.scenario, payload.transaction_id)
        context_text = _context_text(context, payload.screen_context)
        findings = []
        usages = []

        for name, role, focus in TEAM[1:]:
            finding, usage = call_text(
                f"""You are {name}, the {role} specialist on an ACH payments operations team.
{focus}
Analyze only the supplied context. Do not invent facts.
Treat missing evidence as UNKNOWN, never as proof of success or resolution.
If screen_context contains visibleTransaction, use it as the operator-visible transaction even if the database transaction is missing.
State: (1) strongest finding, (2) evidence/signals used, (3) immediate operational implication.
If evidence is insufficient, say what is missing.
If escalation is warranted, the final incident-command handoff is Incident Intelligence / Lindsay; do not make generic technical support or system administration the accountable incident owner.""",
                f"""QUESTION
{payload.question}

ACH CONTEXT
{context_text}""",
            )
            findings.append({"name": name, "role": role, "finding": " ".join(finding.split())})
            usages.append(usage)

        findings_text = "\n".join(f"- {f['name']} ({f['role']}): {f['finding']}" for f in findings)
        contract = """Return a JSON object exactly in this shape:
{
  "summary": "plain-English operating assessment",
  "payment_outcome": "SUCCESSFUL|PENDING|FAILED|RETURNED|UNKNOWN",
  "operations_status": "HEALTHY|WATCH|CRITICAL|RESOLVED|UNKNOWN",
  "likely_cause": "best supported cause or insufficient evidence",
  "recommended_action": "single safest next action",
  "why": "evidence-based explanation",
  "duplicate_risk": "LOW|MEDIUM|HIGH|UNKNOWN",
  "human_approval_required": true,
  "escalate_to_incident_intelligence": false,
  "escalation_target": "Incident Intelligence / Lindsay or none",
  "missing_evidence": ["item"]
}"""
        synthesis, usage = call_json(
            """You are the ACH Operations Lead. Reconcile specialist findings into one safe operating recommendation.
Prefer database and operator-visible screen evidence over inference. Never recommend retry/requeue when downstream acceptance/posting is ambiguous without first checking status.
Treat missing evidence as UNKNOWN, never as proof of success, resolution, or absence of an incident.
A returned payment may be operationally resolved while remaining RETURNED, but only when there is affirmative evidence of operational resolution.
Escalate to Incident Intelligence / Lindsay, the Incident Commander, for material/broad operational impact, sustained processing failure, or unresolved systemic risk. Do not substitute generic technical support/system administration as the final incident owner.
Consequential actions require human approval.""",
            f"""QUESTION
{payload.question}

ACH CONTEXT
{context_text}

SPECIALIST FINDINGS
{findings_text}

{contract}""",
        )
        usages.append(usage)
        if synthesis.get("escalate_to_incident_intelligence"):
            synthesis["escalation_target"] = "Incident Intelligence / Lindsay"
            action = str(synthesis.get("recommended_action") or "").strip()
            if "incident intelligence" not in action.lower() and "lindsay" not in action.lower():
                synthesis["recommended_action"] = (action + " Handoff to Incident Intelligence / Lindsay for incident command.").strip()
        lead = {"name":"ACH Operations Lead","role":"Orchestrator","finding":str(synthesis.get("why") or synthesis.get("summary") or "Team analysis complete.")}
        return {
            "run_id": f"achteam_{uuid.uuid4().hex[:12]}",
            "model": MODEL,
            "agents": [lead, *findings],
            "analysis": synthesis,
            "token_usage": merge_usage(usages),
            "latency_ms": round((time.perf_counter()-started)*1000),
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
