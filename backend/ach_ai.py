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
from governance import log_activity

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
    operator_id: str | None = Field(default=None, max_length=160)
    operator_name: str | None = Field(default=None, max_length=160)
    message: str = Field(min_length=1, max_length=4000)
    scenario: str = Field(default="healthy", max_length=30)
    transaction_id: str | None = Field(default=None, max_length=120)
    screen_context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)

class ACHTeamRequest(BaseModel):
    operator_id: str | None = Field(default=None, max_length=160)
    operator_name: str | None = Field(default=None, max_length=160)
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


def _preflight_association(context: dict[str, Any]) -> dict[str, Any]:
    tx = context.get("transaction") or {}
    preflight = context.get("recent_preflight") or {}
    tx_file = str(tx.get("ach_file_identifier") or "").strip()
    preflight_file = str(preflight.get("filename") or "").strip()
    confirmed = bool(tx_file and preflight_file and tx_file == preflight_file)
    return {
        "status": "CONFIRMED" if confirmed else "UNCONFIRMED",
        "transaction_file_identifier": tx_file or None,
        "preflight_filename": preflight_file or None,
        "rule": (
            "Preflight evidence may be used as transaction-causal evidence only when status is CONFIRMED."
            if confirmed
            else "This preflight run is background evidence only. Do not attribute the displayed transaction failure to it."
        ),
    }


def _authoritative_downstream_state(context: dict[str, Any]) -> dict[str, Any]:
    accepted_stages = {"odfi", "ach operator", "rdfi", "posting"}
    affirmative = []
    for event in context.get("events") or []:
        stage = str(event.get("stage") or "").strip().lower()
        status = str(event.get("status") or "").strip()
        if stage in accepted_stages and status:
            normalized = status.lower()
            if normalized not in {
                "unknown", "pending", "blocked", "not sent", "not reached",
                "waiting", "unavailable", "—", "-"
            }:
                affirmative.append({
                    "stage": event.get("stage"),
                    "status": status,
                    "source_system": event.get("source_system"),
                    "response_code": event.get("response_code"),
                })
    return {
        "known": bool(affirmative),
        "affirmative_events": affirmative,
        "rule": (
            "Affirmative downstream evidence exists."
            if affirmative
            else "Downstream acceptance/posting is UNKNOWN. Missing rows, blocked UI states, timeouts, or absent events do not prove non-acceptance or non-posting."
        ),
    }


def _specialist_context(context: dict[str, Any], specialist_name: str) -> dict[str, Any]:
    tx = context.get("transaction")
    events = context.get("events") or []
    snapshot = context.get("scenario_snapshot")
    preflight = context.get("recent_preflight")
    returns = context.get("return_catalog_sample") or []
    failures = context.get("open_failure_cases") or []
    association = _preflight_association(context)
    downstream = _authoritative_downstream_state(context)

    base = {
        "rail": "ACH",
        "scenario": context.get("scenario"),
        "transaction": tx,
        "scenario_snapshot": snapshot,
        "preflight_association": association,
        "authoritative_downstream_state": downstream,
    }

    if specialist_name == "Nacha Specialist":
        return {**base, "recent_preflight": preflight, "events": [], "return_catalog_sample": [], "open_failure_cases": []}
    if specialist_name == "Returns Specialist":
        return {**base, "recent_preflight": None, "events": [], "return_catalog_sample": returns, "open_failure_cases": failures}
    if specialist_name == "Account & Authorization Specialist":
        return {**base, "recent_preflight": None, "events": [], "return_catalog_sample": [], "open_failure_cases": failures}
    if specialist_name == "Processor & Connectivity Specialist":
        return {**base, "recent_preflight": None, "events": events, "return_catalog_sample": [], "open_failure_cases": []}
    if specialist_name == "Posting & Core Specialist":
        return {**base, "recent_preflight": None, "events": events, "return_catalog_sample": [], "open_failure_cases": []}
    if specialist_name == "Reconciliation Specialist":
        return {**base, "recent_preflight": None, "events": events, "return_catalog_sample": [], "open_failure_cases": []}
    if specialist_name == "Risk & Controls Specialist":
        return {**base, "recent_preflight": None, "events": [], "return_catalog_sample": [], "open_failure_cases": failures}
    return base


def _sanitize_specialist_finding(name: str, finding: str, context: dict[str, Any]) -> str:
    downstream = _authoritative_downstream_state(context)
    if downstream["known"]:
        return finding

    banned_claims = [
        r"\bwas never accepted\b",
        r"\bnever accepted\b",
        r"\bwas not accepted downstream\b",
        r"\bnot accepted downstream\b",
        r"\bwas never posted\b",
        r"\bnever posted\b",
        r"\bwas not posted downstream\b",
        r"\bnot posted downstream\b",
        r"\bno posting occurred\b",
        r"\bno downstream acceptance\b",
        r"\bunlikely to cause duplicate payments\b",
        r"\bsafe to retry\b",
        r"\bsafe to replay\b",
    ]
    found = any(re.search(pattern, finding, flags=re.IGNORECASE) for pattern in banned_claims)
    if not found:
        return finding

    return (
        finding
        + " SAFETY CORRECTION: authoritative downstream acceptance/posting evidence is absent. "
          "Therefore downstream state remains UNKNOWN; this specialist cannot conclude that the payment "
          "was never accepted or posted, and cannot characterize retry/replay as safe or low duplicate risk."
    )


def _context_text(context: dict[str, Any], screen_context: dict[str, Any]) -> str:
    import json
    governed_context = dict(context)
    governed_context["preflight_association"] = _preflight_association(context)
    governed_context["authoritative_downstream_state"] = _authoritative_downstream_state(context)
    return json.dumps({"database_context": governed_context, "screen_context": screen_context}, indent=2, default=str)

@router.post("/chat")
def ach_chat(payload: ACHChatRequest) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")
    started = time.perf_counter()
    run_id = f"achgovchat_{uuid.uuid4().hex[:12]}"
    try:
        context = load_context(payload.scenario, payload.transaction_id)
        history = "\n".join(
            f"{item.get('role','user').upper()}: {item.get('content','')}"
            for item in payload.history[-8:]
        )
        system = """You are ACH Ops Copilot, the operator-facing assistant for a regulated ACH payments operations workspace.
Use the supplied database/screen context as the source of truth. The screen_context may include visibleTransaction, which is the transaction currently displayed to the operator even when the database snapshot is unavailable. Treat it as valid UI evidence and clearly distinguish known fields from unknown downstream fields. Never say no transaction is visible when visibleTransaction is present.
Do not invent downstream acknowledgements, account status, network outcomes, incident status, or resolution state.
ABSENCE OF EVIDENCE IS UNKNOWN, NOT RESOLVED: missing failure-case rows, missing events, unavailable database records, or absent downstream posting records must never be used as proof that an incident is resolved, that a payment succeeded, or that downstream posting did not occur.
For every returned-payment question, state PAYMENT OUTCOME and OPERATIONS/INCIDENT STATUS as two separate fields. PAYMENT OUTCOME may be RETURNED while OPERATIONS/INCIDENT STATUS remains UNKNOWN or UNRESOLVED. Never collapse those two states.
For retry/requeue questions, explicitly check whether downstream acceptance/posting is known before recommending replay because duplicate-payment risk matters.
A recent preflight run is NOT evidence about the displayed transaction unless database_context.preflight_association.status is CONFIRMED. If it is UNCONFIRMED, call it unrelated/background evidence and do not use it as the cause of the displayed transaction failure.
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
        latency_ms = round((time.perf_counter()-started)*1000)
        log_activity(
            activity_type="CHAT",
            agent_name="ACH Ops Copilot",
            command_type="OPERATOR_CHAT",
            command=payload.message,
            evidence_sources=[
                "operations_scenario_snapshots",
                "ach_transactions",
                "ach_transaction_events",
                "ach_preflight_runs",
                "ach_return_code_catalog",
                "ach_failure_cases",
                "screen context",
            ],
            result_summary=answer,
            status="COMPLETED",
            proposed_action="Human operator reviews and decides whether to act on the recommendation.",
            human_approval_required=True,
            rail="ach",
            scenario=payload.scenario,
            run_id=run_id,
            operator_id=payload.operator_id,
            operator_name=payload.operator_name,
            model=MODEL,
            token_usage=usage,
            latency_ms=latency_ms,
            metadata={"transaction_id": payload.transaction_id},
        )
        return {
            "run_id": run_id,
            "model": MODEL,
            "answer": answer,
            "context": {"scenario": payload.scenario, "transaction_id": (context.get("transaction") or {}).get("id")},
            "token_usage": usage,
            "latency_ms": latency_ms,
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
    run_id = f"achgovteam_{uuid.uuid4().hex[:12]}"
    try:
        context = load_context(payload.scenario, payload.transaction_id)
        context_text = _context_text(context, payload.screen_context)
        findings = []
        usages = []

        for name, role, focus in TEAM[1:]:
            specialist_context = _specialist_context(context, name)
            specialist_context_text = _context_text(specialist_context, payload.screen_context)
            finding, usage = call_text(
                f"""You are {name}, the {role} specialist on an ACH payments operations team.
{focus}
Analyze only the supplied specialist-scoped context. Do not invent facts or borrow another specialist's conclusion.
Treat missing evidence as UNKNOWN, never as proof of success, resolution, non-posting, non-acceptance, or absence of downstream activity.
PRE-FLIGHT ASSOCIATION RULE: a recent preflight may be used as causal evidence for this displayed transaction only when preflight_association.status is CONFIRMED. UNCONFIRMED preflight evidence must be labeled unrelated/background and must not appear in likely cause.
DOWNSTREAM INVARIANT: when authoritative_downstream_state.known is false, your finding must literally state "Downstream acceptance/posting: UNKNOWN." Any sentence claiming never accepted, never posted, no posting, safe retry, or unlikely duplicate risk is prohibited.
If downstream acceptance/posting state is not affirmatively known, duplicate risk MUST remain UNKNOWN or HIGH and you MUST NOT say retry/replay is safe or unlikely to duplicate.
If screen_context contains visibleTransaction, use it as the operator-visible transaction even if the database transaction is missing.
State: (1) strongest finding, (2) evidence/signals used, (3) immediate operational implication, (4) what this specialist CANNOT determine from its own evidence.
Role boundaries:
- Nacha Specialist: file/batch/entry/SEC/trace/control totals and preflight only; cannot determine downstream acceptance/posting unless explicit evidence is supplied.
- Returns Specialist: return reason, original linkage, return timing and remediation evidence; cannot infer processor or posting state from a return code alone.
- Account & Authorization Specialist: account state, funds, stop-payment, authorization and receiver conditions; cannot infer network acceptance/posting unless explicit evidence is supplied.
- Processor & Connectivity Specialist: acknowledgements, timeouts, retries, queues and connectivity; cannot infer core posting merely from processor silence.
- Posting & Core Specialist: requires affirmative downstream posting/core evidence. Missing posting records mean UNKNOWN, never "not posted." It must not say retry is unlikely to duplicate unless authoritative downstream acceptance/posting is known.
- Reconciliation Specialist: expected-vs-posted/settled amounts and unmatched activity; cannot independently prove network acceptance unless that evidence is supplied.
- Risk & Controls Specialist: human approval, idempotency, fraud/compliance holds and containment; cannot substitute policy inference for missing transaction state.
If evidence is insufficient, say what is missing.
If escalation is warranted, the final incident-command handoff is Incident Intelligence / Lindsay; do not make generic technical support or system administration the accountable incident owner.""",
                f"""QUESTION
{payload.question}

SPECIALIST-SCOPED ACH CONTEXT
{specialist_context_text}""",
            )
            normalized_finding = " ".join(finding.split())
            findings.append({"name": name, "role": role, "finding": normalized_finding})
            usages.append(usage)
            log_activity(
                activity_type="AGENT_COMMAND",
                agent_name=name,
                command_type="SPECIALIST_ANALYSIS",
                command=payload.question,
                evidence_sources=[
                    "operations_scenario_snapshots",
                    "ach_transactions",
                    "ach_transaction_events",
                    "ach_preflight_runs",
                    "ach_return_code_catalog",
                    "ach_failure_cases",
                    "screen context",
                ],
                result_summary=normalized_finding,
                status="COMPLETED",
                proposed_action="Human operator reviews the specialist recommendation.",
                human_approval_required=True,
                rail="ach",
                scenario=payload.scenario,
                run_id=run_id,
                operator_id=payload.operator_id,
                operator_name=payload.operator_name,
                model=MODEL,
                token_usage=usage,
                metadata={"transaction_id": payload.transaction_id},
            )

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
Prefer database and operator-visible screen evidence over inference. Never recommend retry/requeue when downstream acceptance/posting is ambiguous without first checking authoritative status.
If ANY specialist claims "not posted", "no downstream acceptance", "safe to retry", "unlikely to duplicate", or equivalent language without affirmative downstream evidence, override that claim as unsupported and set duplicate_risk to UNKNOWN or HIGH.
HARD INVARIANT: if authoritative_downstream_state.known is false, the synthesis must say downstream acceptance/posting is UNKNOWN and must not repeat any specialist assertion that the payment was never accepted or posted.
PRE-FLIGHT CAUSALITY: recent_preflight can be cited as the transaction's cause only if preflight_association.status is CONFIRMED. If UNCONFIRMED, it must be excluded from likely_cause and described only as unrelated/background evidence.
Treat missing evidence as UNKNOWN, never as proof of success, resolution, non-posting, non-acceptance, or absence of an incident.
For returned-payment questions, keep payment_outcome and operations_status independent. A payment can be RETURNED while operations_status is UNKNOWN or UNRESOLVED when incident/remediation evidence is missing.
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
        latency_ms = round((time.perf_counter()-started)*1000)
        merged_usage = merge_usage(usages)
        log_activity(
            activity_type="AGENT_SYNTHESIS",
            agent_name="ACH Operations Lead",
            command_type="TEAM_SYNTHESIS",
            command=payload.question,
            evidence_sources=["specialist findings", "ACH database context", "screen context"],
            result_summary=str(synthesis.get("summary") or "Team analysis complete."),
            status=str(synthesis.get("operations_status") or "COMPLETED"),
            proposed_action=str(synthesis.get("recommended_action") or ""),
            human_approval_required=bool(synthesis.get("human_approval_required", True)),
            escalation_target="Incident Intelligence / Lindsay" if synthesis.get("escalate_to_incident_intelligence") else None,
            rail="ach",
            scenario=payload.scenario,
            run_id=run_id,
            operator_id=payload.operator_id,
            operator_name=payload.operator_name,
            model=MODEL,
            token_usage=merged_usage,
            latency_ms=latency_ms,
            metadata={"transaction_id": payload.transaction_id, "duplicate_risk": synthesis.get("duplicate_risk")},
        )
        return {
            "run_id": run_id,
            "model": MODEL,
            "agents": [lead, *findings],
            "analysis": synthesis,
            "token_usage": merged_usage,
            "latency_ms": latency_ms,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
