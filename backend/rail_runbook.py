from __future__ import annotations

import json
import os
import time
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from agentic.core import MODEL, call_json, call_text, merge_usage
from ach_ai import TEAM, load_context as load_ach_context
from governance import log_activity

router = APIRouter(prefix="/api/rail-runbook", tags=["rail-runbook"])

RAIL_LABELS = {
    "ach": "ACH",
    "fednow": "FedNow",
    "fedwire": "FedWire",
    "rtp": "RTP",
}

TEAM_LOOKUP = {name: (role, focus) for name, role, focus in TEAM}

PHASE_SPECIALISTS = {
    "Start of day": ["Processor & Connectivity Specialist", "Reconciliation Specialist", "Risk & Controls Specialist"],
    "File and message intake": ["Nacha Specialist", "Processor & Connectivity Specialist", "Risk & Controls Specialist"],
    "Validation and risk": ["Nacha Specialist", "Account & Authorization Specialist", "Risk & Controls Specialist"],
    "Transmission and acknowledgements": ["Processor & Connectivity Specialist", "Risk & Controls Specialist"],
    "Receipt and posting": ["Posting & Core Specialist", "Reconciliation Specialist"],
    "Returns and exceptions": ["Returns Specialist", "Risk & Controls Specialist"],
    "Reconciliation": ["Reconciliation Specialist", "Posting & Core Specialist", "Processor & Connectivity Specialist"],
    "End of day": ["Reconciliation Specialist", "Risk & Controls Specialist"],
}

class RunbookStepRequest(BaseModel):
    operator_id: str = Field(min_length=3, max_length=160)
    operator_name: str = Field(min_length=1, max_length=160)
    rail: str = Field(min_length=2, max_length=30)
    step_id: str = Field(min_length=2, max_length=80)
    phase: str = Field(min_length=2, max_length=120)
    task: str = Field(min_length=5, max_length=3000)
    evidence_expected: str = Field(default="", max_length=3000)
    scenario: str = Field(default="healthy", max_length=30)
    transaction_id: str | None = Field(default=None, max_length=160)
    screen_context: dict[str, Any] = Field(default_factory=dict)

class RunbookApprovalRequest(BaseModel):
    operator_id: str = Field(min_length=3, max_length=160)
    operator_name: str = Field(min_length=1, max_length=160)
    run_id: str = Field(min_length=5, max_length=120)
    approved: bool = True
    approver_note: str | None = Field(default=None, max_length=2000)

def _db() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is not configured")
    return value

def _jsonable(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out: dict[str, Any] = {}
    for key, value in dict(row).items():
        if isinstance(value, Decimal):
            out[key] = float(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out

def _ensure_schema() -> None:
    with psycopg.connect(_db(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rail_runbook_step_runs (
                    id text PRIMARY KEY,
                    run_date date NOT NULL DEFAULT current_date,
                    operator_id text NOT NULL,
                    operator_name text NOT NULL,
                    rail text NOT NULL,
                    step_id text NOT NULL,
                    phase text NOT NULL,
                    scenario text NOT NULL,
                    task text NOT NULL,
                    result_status text NOT NULL,
                    can_approve boolean NOT NULL DEFAULT false,
                    result jsonb NOT NULL,
                    model text,
                    token_usage jsonb,
                    latency_ms integer,
                    created_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS rail_runbook_step_runs_operator_day_idx
                    ON rail_runbook_step_runs (operator_id, run_date, rail, step_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS rail_runbook_step_runs_day_rail_idx
                    ON rail_runbook_step_runs (run_date, rail, created_at DESC);

                CREATE TABLE IF NOT EXISTS rail_runbook_approvals (
                    id bigserial PRIMARY KEY,
                    run_id text NOT NULL REFERENCES rail_runbook_step_runs(id) ON DELETE CASCADE,
                    operator_id text NOT NULL,
                    operator_name text NOT NULL,
                    rail text NOT NULL,
                    step_id text NOT NULL,
                    approved boolean NOT NULL,
                    approver_note text,
                    approved_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS rail_runbook_approvals_run_idx
                    ON rail_runbook_approvals (run_id, approved_at DESC);
            """)

            # Carry forward any v8.x ACH run-book history once, if those tables exist.
            cur.execute("SELECT to_regclass('public.ach_runbook_step_runs') AS table_name")
            if cur.fetchone()[0]:
                cur.execute("""
                    INSERT INTO rail_runbook_step_runs
                    (id,run_date,operator_id,operator_name,rail,step_id,phase,scenario,task,
                     result_status,can_approve,result,model,token_usage,latency_ms,created_at)
                    SELECT id,run_date,
                           COALESCE(operator_id,'legacy-ach-operator'),
                           COALESCE(operator_name,'ACH Operator'),
                           'ach',step_id,phase,scenario,task,result_status,can_approve,result,
                           model,token_usage,latency_ms,created_at
                    FROM ach_runbook_step_runs
                    ON CONFLICT (id) DO NOTHING
                """)
            cur.execute("SELECT to_regclass('public.ach_runbook_approvals') AS table_name")
            if cur.fetchone()[0]:
                cur.execute("""
                    INSERT INTO rail_runbook_approvals
                    (run_id,operator_id,operator_name,rail,step_id,approved,approver_note,approved_at)
                    SELECT a.run_id,
                           COALESCE(a.operator_id,r.operator_id,'legacy-ach-operator'),
                           COALESCE(a.operator_name,r.operator_name,'ACH Operator'),
                           'ach',a.step_id,a.approved,a.approver_note,a.approved_at
                    FROM ach_runbook_approvals a
                    LEFT JOIN rail_runbook_step_runs r ON r.id=a.run_id
                    WHERE NOT EXISTS (
                        SELECT 1 FROM rail_runbook_approvals x
                        WHERE x.run_id=a.run_id AND x.approved_at=a.approved_at
                    )
                """)

def _load_non_ach_context(rail: str, scenario: str) -> dict[str, Any]:
    context: dict[str, Any] = {
        "rail": rail,
        "scenario": scenario,
        "scenario_snapshot": None,
        "recent_message_test": None,
        "open_failure_cases": [],
    }
    with psycopg.connect(_db(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM rail_scenario_state WHERE rail=%s AND scenario=%s",
                (rail, scenario),
            )
            context["scenario_snapshot"] = _jsonable(cur.fetchone())

            cur.execute(
                """SELECT id,filename,message_id,message_type,passed,error_count,warning_count,created_at
                   FROM rail_test_runs
                   WHERE rail=%s
                   ORDER BY created_at DESC
                   LIMIT 1""",
                (rail,),
            )
            context["recent_message_test"] = _jsonable(cur.fetchone())

            cur.execute(
                """SELECT code,NULLIF(message_type,'') AS message_type,category,title,severity,
                          public_documentation,case_status
                   FROM rail_failure_catalog
                   WHERE rail=%s AND case_status='OPEN'
                   ORDER BY category,code,message_type
                   LIMIT 100""",
                (rail,),
            )
            context["open_failure_cases"] = [_jsonable(r) for r in cur.fetchall()]
    return context

def load_rail_context(rail: str, scenario: str, transaction_id: str | None) -> dict[str, Any]:
    rail = rail.lower()
    if rail == "ach":
        return load_ach_context(scenario, transaction_id)
    return _load_non_ach_context(rail, scenario)

def _context_text(context: dict[str, Any], screen_context: dict[str, Any]) -> str:
    return json.dumps(
        {"database_context": context, "screen_context": screen_context},
        indent=2,
        default=str,
    )

def _specialists_for_phase(phase: str) -> list[str]:
    return PHASE_SPECIALISTS.get(phase, ["Risk & Controls Specialist", "Reconciliation Specialist"])

@router.post("/run-step")
def run_step(payload: RunbookStepRequest) -> dict[str, Any]:
    rail = payload.rail.lower()
    if rail not in RAIL_LABELS:
        raise HTTPException(status_code=404, detail="Unknown payment rail")
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    started = time.perf_counter()
    run_id = f"railrb_{uuid.uuid4().hex[:12]}"
    try:
        _ensure_schema()
        context = load_rail_context(rail, payload.scenario, payload.transaction_id)
        context_text = _context_text(context, payload.screen_context)
        findings: list[dict[str, str]] = []
        usages: list[dict[str, Any]] = []

        for name in _specialists_for_phase(payload.phase):
            role, focus = TEAM_LOOKUP[name]
            finding, usage = call_text(
                f"""You are {name}, the {role} specialist on a multi-rail payments operations team.
Current payment rail: {RAIL_LABELS[rail]}.
{focus}

Complete the investigative/review work that can be completed from supplied evidence for one daily operations run-book step.
Do not invent evidence. Missing evidence is UNKNOWN, never success.
For non-ACH rails, do not apply ACH/Nacha-specific rules unless the current rail is ACH.
Do not transmit payments, move funds, alter account state, release files/messages, retry/replay, or perform another consequential action.
State:
1. what you checked,
2. evidence found,
3. exceptions or risks,
4. whether your part is ready for human approval.""",
                f"""RUN BOOK STEP
Rail: {RAIL_LABELS[rail]}
Phase: {payload.phase}
Task: {payload.task}
Expected evidence: {payload.evidence_expected}

CURRENT RAIL EVIDENCE
{context_text}""",
            )
            normalized_finding = " ".join(finding.split())
            findings.append({"name": name, "role": role, "finding": normalized_finding})
            usages.append(usage)
            log_activity(
                activity_type="RUNBOOK_AGENT",
                agent_name=name,
                command_type="RUNBOOK_STEP_REVIEW",
                command=payload.task,
                evidence_sources=["rail context", "screen context", payload.evidence_expected],
                result_summary=normalized_finding,
                status="COMPLETED",
                proposed_action="Human SME reviews the specialist result before consequential action.",
                human_approval_required=True,
                rail=rail,
                scenario=payload.scenario,
                run_id=run_id,
                operator_id=payload.operator_id,
                operator_name=payload.operator_name,
                model=MODEL,
                token_usage=usage,
                metadata={"step_id": payload.step_id, "phase": payload.phase},
            )

        findings_text = "\n".join(
            f"- {f['name']} ({f['role']}): {f['finding']}" for f in findings
        )

        contract = """Return JSON exactly in this shape:
{
  "status": "READY_FOR_APPROVAL|NEEDS_ATTENTION|BLOCKED_MISSING_EVIDENCE",
  "summary": "what the AI team completed for this step",
  "checks_performed": ["check"],
  "evidence_found": ["specific evidence"],
  "exceptions": ["exception or risk"],
  "missing_evidence": ["specific missing item"],
  "recommended_human_action": "what the human SME should do next",
  "can_approve": true,
  "human_approval_reason": "why human approval is required",
  "escalate_to_incident_intelligence": false,
  "escalation_reason": "reason or none"
}"""

        synthesis, usage = call_json(
            f"""You are the Payments Operations Lead completing a {RAIL_LABELS[rail]} daily run-book step.
Reconcile specialist findings into one defensible result.

Rules:
- Evidence must come from supplied context or specialist findings.
- Missing evidence is UNKNOWN, never success.
- READY_FOR_APPROVAL means available evidence supports completion and a human SME can review and approve.
- NEEDS_ATTENTION means work was completed but a non-blocking exception needs explicit human review.
- BLOCKED_MISSING_EVIDENCE means required evidence is absent or a safe determination cannot be made; can_approve MUST be false.
- Do not claim to execute money movement, payment transmission, message/file release, funding, account changes, compliance decisions, or retry/replay.
- Apply rail-specific reasoning for {RAIL_LABELS[rail]}; do not substitute ACH rules on another rail.
- For broad impact, sustained disruption, or systemic risk, escalate to Incident Intelligence / Lindsay.
- Human SME is final approver.""",
            f"""RUN BOOK STEP
Rail: {RAIL_LABELS[rail]}
Phase: {payload.phase}
Task: {payload.task}
Expected evidence: {payload.evidence_expected}

RAIL CONTEXT
{context_text}

SPECIALIST WORK
{findings_text}

{contract}""",
        )
        usages.append(usage)

        status = str(synthesis.get("status") or "BLOCKED_MISSING_EVIDENCE").upper()
        if status not in {"READY_FOR_APPROVAL", "NEEDS_ATTENTION", "BLOCKED_MISSING_EVIDENCE"}:
            status = "BLOCKED_MISSING_EVIDENCE"
        can_approve = bool(synthesis.get("can_approve")) and status != "BLOCKED_MISSING_EVIDENCE"

        if synthesis.get("escalate_to_incident_intelligence"):
            synthesis["escalation_target"] = "Incident Intelligence / Lindsay"

        synthesis["status"] = status
        synthesis["can_approve"] = can_approve
        synthesis["specialist_findings"] = findings
        synthesis["rail"] = RAIL_LABELS[rail]

        latency_ms = round((time.perf_counter() - started) * 1000)
        token_usage = merge_usage(usages)
        log_activity(
            activity_type="AGENT_SYNTHESIS",
            agent_name=f"{RAIL_LABELS[rail]} Payments Operations Lead",
            command_type="RUNBOOK_SYNTHESIS",
            command=payload.task,
            evidence_sources=["specialist findings", "rail context", "screen context"],
            result_summary=str(synthesis.get("summary") or "Run-book synthesis complete."),
            status=status,
            proposed_action=str(synthesis.get("recommended_human_action") or ""),
            human_approval_required=True,
            escalation_target="Incident Intelligence / Lindsay" if synthesis.get("escalate_to_incident_intelligence") else None,
            rail=rail,
            scenario=payload.scenario,
            run_id=run_id,
            operator_id=payload.operator_id,
            operator_name=payload.operator_name,
            model=MODEL,
            token_usage=token_usage,
            latency_ms=round((time.perf_counter() - started) * 1000),
            metadata={"step_id": payload.step_id, "phase": payload.phase},
        )

        with psycopg.connect(_db(), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO rail_runbook_step_runs
                       (id,operator_id,operator_name,rail,step_id,phase,scenario,task,
                        result_status,can_approve,result,model,token_usage,latency_ms)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        run_id,payload.operator_id,payload.operator_name,rail,payload.step_id,
                        payload.phase,payload.scenario,payload.task,status,can_approve,
                        Jsonb(synthesis),MODEL,Jsonb(token_usage),latency_ms,
                    ),
                )

        return {
            "run_id": run_id,
            "rail": rail,
            "step_id": payload.step_id,
            "phase": payload.phase,
            "model": MODEL,
            "result": synthesis,
            "token_usage": token_usage,
            "latency_ms": latency_ms,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.post("/approve")
def approve_step(payload: RunbookApprovalRequest) -> dict[str, Any]:
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT id,operator_id,operator_name,rail,step_id,result_status,can_approve
                       FROM rail_runbook_step_runs WHERE id=%s""",
                    (payload.run_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Run-book result not found")
                if row["operator_id"] != payload.operator_id:
                    raise HTTPException(status_code=403, detail="This step belongs to a different operator.")
                if payload.approved and not row["can_approve"]:
                    raise HTTPException(
                        status_code=409,
                        detail="This step is blocked and cannot be approved until evidence is resolved and the AI step is rerun.",
                    )
                cur.execute(
                    """INSERT INTO rail_runbook_approvals
                       (run_id,operator_id,operator_name,rail,step_id,approved,approver_note)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)
                       RETURNING approved_at""",
                    (
                        payload.run_id,payload.operator_id,payload.operator_name,
                        row["rail"],row["step_id"],payload.approved,payload.approver_note,
                    ),
                )
                approved_at = cur.fetchone()["approved_at"]
                log_activity(
                    activity_type="HUMAN_APPROVAL",
                    agent_name="Human SME",
                    command_type="RUNBOOK_APPROVAL",
                    command=f"Approve {row['rail'].upper()} run-book step {row['step_id']}",
                    evidence_sources=["AI run-book result", "specialist evidence package"],
                    result_summary="Run-book step approved by the human SME." if payload.approved else "Run-book step not approved.",
                    status="APPROVED" if payload.approved else "REJECTED",
                    human_approval_required=False,
                    rail=row["rail"],
                    run_id=payload.run_id,
                    operator_id=payload.operator_id,
                    operator_name=payload.operator_name,
                    metadata={"step_id": row["step_id"], "approver_note": payload.approver_note},
                )
                return {
                    "run_id": payload.run_id,
                    "rail": row["rail"],
                    "step_id": row["step_id"],
                    "approved": payload.approved,
                    "approved_at": approved_at.isoformat(),
                    "result_status": row["result_status"],
                }
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.get("/today")
def today_status(operator_id: str, rail: str) -> dict[str, Any]:
    rail = rail.lower()
    if rail not in RAIL_LABELS:
        raise HTTPException(status_code=404, detail="Unknown payment rail")
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT DISTINCT ON (r.step_id)
                              r.id AS run_id,r.rail,r.step_id,r.phase,r.result_status,r.can_approve,
                              r.result,r.created_at,r.operator_name,
                              a.approved,a.approved_at,a.approver_note
                       FROM rail_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at,approver_note
                           FROM rail_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.run_date=current_date AND r.operator_id=%s AND r.rail=%s
                       ORDER BY r.step_id,r.created_at DESC""",
                    (operator_id, rail),
                )
                rows = []
                for row in cur.fetchall():
                    item = dict(row)
                    for key in ("created_at", "approved_at"):
                        if item.get(key):
                            item[key] = item[key].isoformat()
                    rows.append(item)
                return {"date": date.today().isoformat(), "rail": rail, "steps": rows}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.get("/activity")
def activity_report(operator_id: str) -> dict[str, Any]:
    """All rails for one operator."""
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT r.id AS run_id,r.run_date,r.rail,r.step_id,r.phase,r.task,r.result_status,
                              r.can_approve,r.result,r.created_at,r.operator_name,
                              a.approved,a.approved_at,a.approver_note
                       FROM rail_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at,approver_note
                           FROM rail_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.operator_id=%s
                       ORDER BY r.created_at DESC
                       LIMIT 1000""",
                    (operator_id,),
                )
                rows = []
                for row in cur.fetchall():
                    item = dict(row)
                    for key in ("run_date", "created_at", "approved_at"):
                        if item.get(key) and hasattr(item[key], "isoformat"):
                            item[key] = item[key].isoformat()
                    rows.append(item)
                by_rail: dict[str, int] = {}
                for row in rows:
                    if row.get("approved"):
                        by_rail[row["rail"]] = by_rail.get(row["rail"], 0) + 1
                return {
                    "operator_id": operator_id,
                    "operator_name": next((r.get("operator_name") for r in rows if r.get("operator_name")), None),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "approved_steps": sum(1 for r in rows if r.get("approved")),
                    "approved_steps_by_rail": by_rail,
                    "runs": rows,
                }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.get("/manager-summary")
def manager_summary() -> dict[str, Any]:
    """All rails, whole team. Demo only: add manager RBAC before production."""
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT r.operator_id,
                              MAX(r.operator_name) AS operator_name,
                              COUNT(*) AS ai_runs,
                              COUNT(*) FILTER (WHERE a.approved=true) AS approved_steps,
                              COUNT(DISTINCT r.rail) AS rails_worked,
                              COUNT(*) FILTER (WHERE r.result_status='READY_FOR_APPROVAL') AS ready_count,
                              COUNT(*) FILTER (WHERE r.result_status='NEEDS_ATTENTION') AS attention_count,
                              COUNT(*) FILTER (WHERE r.result_status='BLOCKED_MISSING_EVIDENCE') AS blocked_count,
                              MAX(r.created_at) AS last_activity_at
                       FROM rail_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at
                           FROM rail_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.run_date=current_date
                       GROUP BY r.operator_id
                       ORDER BY MAX(r.created_at) DESC"""
                )
                members = []
                for row in cur.fetchall():
                    item = dict(row)
                    if item.get("last_activity_at"):
                        item["last_activity_at"] = item["last_activity_at"].isoformat()
                    members.append(item)

                cur.execute(
                    """SELECT rail,
                              COUNT(*) AS ai_runs,
                              COUNT(*) FILTER (WHERE result_status='READY_FOR_APPROVAL') AS ready_count,
                              COUNT(*) FILTER (WHERE result_status='NEEDS_ATTENTION') AS attention_count,
                              COUNT(*) FILTER (WHERE result_status='BLOCKED_MISSING_EVIDENCE') AS blocked_count
                       FROM rail_runbook_step_runs
                       WHERE run_date=current_date
                       GROUP BY rail
                       ORDER BY rail"""
                )
                rail_totals = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    """SELECT rail,COUNT(*) AS approved_steps
                       FROM rail_runbook_approvals a
                       JOIN rail_runbook_step_runs r ON r.id=a.run_id
                       WHERE r.run_date=current_date AND a.approved=true
                       GROUP BY rail"""
                )
                approvals_by_rail = {r["rail"]: r["approved_steps"] for r in cur.fetchall()}
                for item in rail_totals:
                    item["approved_steps"] = approvals_by_rail.get(item["rail"], 0)

                cur.execute(
                    """SELECT COUNT(*) AS ai_runs,
                              COUNT(DISTINCT operator_id) AS active_operators,
                              COUNT(DISTINCT rail) AS rails_active,
                              COUNT(*) FILTER (WHERE result_status='NEEDS_ATTENTION') AS attention_count,
                              COUNT(*) FILTER (WHERE result_status='BLOCKED_MISSING_EVIDENCE') AS blocked_count
                       FROM rail_runbook_step_runs
                       WHERE run_date=current_date"""
                )
                totals = dict(cur.fetchone())
                cur.execute(
                    """SELECT COUNT(*) AS approved_steps
                       FROM rail_runbook_approvals a
                       JOIN rail_runbook_step_runs r ON r.id=a.run_id
                       WHERE r.run_date=current_date AND a.approved=true"""
                )
                totals["approved_steps"] = cur.fetchone()["approved_steps"]

                cur.execute(
                    """SELECT r.operator_id,r.operator_name,r.rail,r.step_id,r.phase,r.result_status,
                              r.created_at,a.approved,a.approved_at
                       FROM rail_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at
                           FROM rail_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.run_date=current_date
                       ORDER BY r.created_at DESC
                       LIMIT 150"""
                )
                recent = []
                for row in cur.fetchall():
                    item = dict(row)
                    for key in ("created_at", "approved_at"):
                        if item.get(key):
                            item[key] = item[key].isoformat()
                    recent.append(item)

                return {
                    "date": date.today().isoformat(),
                    "totals": totals,
                    "rail_totals": rail_totals,
                    "members": members,
                    "recent_activity": recent,
                }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
