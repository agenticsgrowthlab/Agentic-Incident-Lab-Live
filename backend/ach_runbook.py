from __future__ import annotations

import json
import os
import time
import uuid
from datetime import date
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from agentic.core import MODEL, call_json, call_text, merge_usage
from ach_ai import TEAM, load_context

router = APIRouter(prefix="/api/ach-runbook", tags=["ach-runbook"])

PHASE_SPECIALISTS = {
    "Start of day": ["Processor & Connectivity Specialist", "Reconciliation Specialist", "Risk & Controls Specialist"],
    "File intake and origination": ["Nacha Specialist", "Account & Authorization Specialist", "Risk & Controls Specialist"],
    "Transmission and acknowledgements": ["Processor & Connectivity Specialist", "Risk & Controls Specialist"],
    "Receipt and posting": ["Posting & Core Specialist", "Reconciliation Specialist"],
    "Returns, NOCs and exceptions": ["Returns Specialist", "Risk & Controls Specialist"],
    "Reconciliation": ["Reconciliation Specialist", "Posting & Core Specialist", "Processor & Connectivity Specialist"],
    "End of day": ["Reconciliation Specialist", "Risk & Controls Specialist"],
}

TEAM_LOOKUP = {name: (role, focus) for name, role, focus in TEAM}

class RunbookStepRequest(BaseModel):
    operator_id: str = Field(min_length=3, max_length=160)
    operator_name: str = Field(min_length=1, max_length=160)
    step_id: str = Field(min_length=2, max_length=80)
    phase: str = Field(min_length=2, max_length=120)
    task: str = Field(min_length=5, max_length=3000)
    evidence_expected: str = Field(default="", max_length=3000)
    scenario: str = Field(default="healthy", max_length=30)
    transaction_id: str | None = Field(default=None, max_length=120)
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

def _ensure_schema() -> None:
    with psycopg.connect(_db(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                CREATE TABLE IF NOT EXISTS ach_runbook_step_runs (
                    id text PRIMARY KEY,
                    run_date date NOT NULL DEFAULT current_date,
                    operator_id text,
                    operator_name text,
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
                CREATE INDEX IF NOT EXISTS ach_runbook_step_runs_day_idx
                    ON ach_runbook_step_runs (run_date, step_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS ach_runbook_approvals (
                    id bigserial PRIMARY KEY,
                    run_id text NOT NULL REFERENCES ach_runbook_step_runs(id) ON DELETE CASCADE,
                    operator_id text,
                    operator_name text,
                    step_id text NOT NULL,
                    approved boolean NOT NULL,
                    approver_note text,
                    approved_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS ach_runbook_approvals_run_idx
                    ON ach_runbook_approvals (run_id, approved_at DESC);

                ALTER TABLE ach_runbook_step_runs ADD COLUMN IF NOT EXISTS operator_id text;
                ALTER TABLE ach_runbook_step_runs ADD COLUMN IF NOT EXISTS operator_name text;
                ALTER TABLE ach_runbook_approvals ADD COLUMN IF NOT EXISTS operator_id text;
                ALTER TABLE ach_runbook_approvals ADD COLUMN IF NOT EXISTS operator_name text;
                CREATE INDEX IF NOT EXISTS ach_runbook_step_runs_operator_day_idx
                    ON ach_runbook_step_runs (operator_id, run_date, step_id, created_at DESC);
                '''
            )

def _context_text(context: dict[str, Any], screen_context: dict[str, Any]) -> str:
    return json.dumps(
        {"database_context": context, "screen_context": screen_context},
        indent=2,
        default=str,
    )

def _specialists_for_phase(phase: str) -> list[str]:
    return PHASE_SPECIALISTS.get(phase, ["Risk & Controls Specialist"])

@router.post("/run-step")
def run_step(payload: RunbookStepRequest) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    started = time.perf_counter()
    try:
        _ensure_schema()
        context = load_context(payload.scenario, payload.transaction_id)
        context_text = _context_text(context, payload.screen_context)
        specialist_names = _specialists_for_phase(payload.phase)
        findings: list[dict[str, str]] = []
        usages: list[dict[str, Any]] = []

        for name in specialist_names:
            role, focus = TEAM_LOOKUP[name]
            finding, usage = call_text(
                f"""You are {name}, the {role} specialist on an ACH operations team.
{focus}

You are completing one step of a daily ACH operations run book for a human SME.
Do the investigative/review work that can be completed from the supplied evidence.
Do not invent evidence. Missing data means UNKNOWN, not success.
Do not transmit a payment, move funds, alter account state, release a file, or perform any other consequential action.
If the step needs evidence not present in the supplied context, identify it specifically.
State:
1. what you checked,
2. evidence found,
3. exceptions or risks,
4. whether this part of the step is ready for human approval.""",
                f"""RUN BOOK STEP
Phase: {payload.phase}
Task: {payload.task}
Expected evidence: {payload.evidence_expected}

CURRENT ACH EVIDENCE
{context_text}""",
            )
            findings.append({"name": name, "role": role, "finding": " ".join(finding.split())})
            usages.append(usage)

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
            """You are the ACH Operations Lead completing a daily operations run-book step.
Reconcile the specialist findings into a defensible operational result.

Rules:
- Evidence must come from supplied database/screen context or specialist findings.
- Missing evidence is UNKNOWN, never success.
- READY_FOR_APPROVAL means available evidence supports completion and the human SME can review and approve.
- NEEDS_ATTENTION means work was completed but one or more non-blocking exceptions need explicit human review; can_approve may be true only if evidence supports controlled acceptance.
- BLOCKED_MISSING_EVIDENCE means required evidence is absent or a safe determination cannot be made; can_approve MUST be false.
- Do not execute or claim to execute money movement, payment transmission, file release, account changes, compliance decisions, funding actions, retry/replay, or other consequential actions.
- For broad impact, sustained disruption, or systemic risk, escalate to Incident Intelligence / Lindsay.
- The human SME is the final approver.""",
            f"""RUN BOOK STEP
Phase: {payload.phase}
Task: {payload.task}
Expected evidence: {payload.evidence_expected}

ACH CONTEXT
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

        run_id = f"achrb_{uuid.uuid4().hex[:12]}"
        latency_ms = round((time.perf_counter() - started) * 1000)
        token_usage = merge_usage(usages)

        with psycopg.connect(_db(), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO ach_runbook_step_runs
                       (id,operator_id,operator_name,step_id,phase,scenario,task,result_status,can_approve,result,model,token_usage,latency_ms)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        run_id,
                        payload.operator_id,
                        payload.operator_name,
                        payload.step_id,
                        payload.phase,
                        payload.scenario,
                        payload.task,
                        status,
                        can_approve,
                        Jsonb(synthesis),
                        MODEL,
                        Jsonb(token_usage),
                        latency_ms,
                    ),
                )

        return {
            "run_id": run_id,
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
                    """SELECT id,operator_id,step_id,result_status,can_approve
                       FROM ach_runbook_step_runs WHERE id=%s""",
                    (payload.run_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Run-book step result not found")
                if row.get("operator_id") and row["operator_id"] != payload.operator_id:
                    raise HTTPException(status_code=403, detail="This run-book step belongs to a different operator.")
                if payload.approved and not row["can_approve"]:
                    raise HTTPException(
                        status_code=409,
                        detail="This step is blocked and cannot be approved until missing evidence is resolved and the AI step is rerun.",
                    )
                cur.execute(
                    """INSERT INTO ach_runbook_approvals
                       (run_id,operator_id,operator_name,step_id,approved,approver_note)
                       VALUES (%s,%s,%s,%s,%s,%s)
                       RETURNING approved_at""",
                    (payload.run_id, payload.operator_id, payload.operator_name, row["step_id"], payload.approved, payload.approver_note),
                )
                approved_at = cur.fetchone()["approved_at"]
                return {
                    "run_id": payload.run_id,
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
def today_status(operator_id: str) -> dict[str, Any]:
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT DISTINCT ON (r.step_id)
                              r.id AS run_id,r.step_id,r.phase,r.result_status,r.can_approve,
                              r.result,r.created_at,r.operator_name,
                              a.approved,a.approved_at,a.approver_note
                       FROM ach_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at,approver_note
                           FROM ach_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.run_date=current_date AND r.operator_id=%s
                       ORDER BY r.step_id,r.created_at DESC""",
                    (operator_id,),
                )
                rows = []
                for row in cur.fetchall():
                    item = dict(row)
                    for key in ("created_at", "approved_at"):
                        if item.get(key):
                            item[key] = item[key].isoformat()
                    rows.append(item)
                return {"date": date.today().isoformat(), "steps": rows}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.get("/activity")
def activity_report(operator_id: str) -> dict[str, Any]:
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT r.id AS run_id,r.run_date,r.step_id,r.phase,r.task,r.result_status,
                              r.can_approve,r.result,r.created_at,r.operator_name,
                              a.approved,a.approved_at,a.approver_note
                       FROM ach_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at,approver_note
                           FROM ach_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.operator_id=%s
                       ORDER BY r.created_at DESC
                       LIMIT 500""",
                    (operator_id,),
                )
                rows = []
                for row in cur.fetchall():
                    item = dict(row)
                    for key in ("run_date", "created_at", "approved_at"):
                        if item.get(key) and hasattr(item[key], "isoformat"):
                            item[key] = item[key].isoformat()
                    rows.append(item)
                approved_count = sum(1 for r in rows if r.get("approved"))
                return {
                    "operator_id": operator_id,
                    "operator_name": next((r.get("operator_name") for r in rows if r.get("operator_name")), None),
                    "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                    "approved_steps": approved_count,
                    "runs": rows,
                }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/manager-summary")
def manager_summary() -> dict[str, Any]:
    """Demo manager view across all operator profiles. Add authenticated manager authorization before production use."""
    try:
        _ensure_schema()
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT r.operator_id,
                              MAX(r.operator_name) AS operator_name,
                              COUNT(*) AS ai_runs,
                              COUNT(*) FILTER (WHERE a.approved=true) AS approved_steps,
                              COUNT(*) FILTER (WHERE r.result_status='READY_FOR_APPROVAL') AS ready_count,
                              COUNT(*) FILTER (WHERE r.result_status='NEEDS_ATTENTION') AS attention_count,
                              COUNT(*) FILTER (WHERE r.result_status='BLOCKED_MISSING_EVIDENCE') AS blocked_count,
                              MAX(r.created_at) AS last_activity_at,
                              MAX(a.approved_at) AS last_approval_at
                       FROM ach_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at
                           FROM ach_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.run_date=current_date
                         AND r.operator_id IS NOT NULL
                       GROUP BY r.operator_id
                       ORDER BY COALESCE(MAX(a.approved_at),MAX(r.created_at)) DESC"""
                )
                members = []
                for row in cur.fetchall():
                    item = dict(row)
                    for key in ("last_activity_at", "last_approval_at"):
                        if item.get(key):
                            item[key] = item[key].isoformat()
                    members.append(item)

                cur.execute(
                    """SELECT
                           COUNT(*) AS ai_runs,
                           COUNT(DISTINCT operator_id) FILTER (WHERE operator_id IS NOT NULL) AS active_operators,
                           COUNT(*) FILTER (WHERE result_status='READY_FOR_APPROVAL') AS ready_count,
                           COUNT(*) FILTER (WHERE result_status='NEEDS_ATTENTION') AS attention_count,
                           COUNT(*) FILTER (WHERE result_status='BLOCKED_MISSING_EVIDENCE') AS blocked_count
                       FROM ach_runbook_step_runs
                       WHERE run_date=current_date"""
                )
                totals = dict(cur.fetchone())

                cur.execute(
                    """SELECT COUNT(*) AS approved_steps
                       FROM ach_runbook_approvals a
                       JOIN ach_runbook_step_runs r ON r.id=a.run_id
                       WHERE r.run_date=current_date AND a.approved=true"""
                )
                totals["approved_steps"] = cur.fetchone()["approved_steps"]

                cur.execute(
                    """SELECT r.operator_id,r.operator_name,r.step_id,r.phase,r.result_status,
                              r.created_at,a.approved,a.approved_at
                       FROM ach_runbook_step_runs r
                       LEFT JOIN LATERAL (
                           SELECT approved,approved_at
                           FROM ach_runbook_approvals
                           WHERE run_id=r.id
                           ORDER BY approved_at DESC
                           LIMIT 1
                       ) a ON true
                       WHERE r.run_date=current_date
                       ORDER BY r.created_at DESC
                       LIMIT 100"""
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
                    "members": members,
                    "recent_activity": recent,
                }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
