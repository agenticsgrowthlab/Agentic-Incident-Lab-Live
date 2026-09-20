from __future__ import annotations

import csv
import io
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

router = APIRouter(prefix="/api/governance", tags=["governance"])

RETENTION_DAYS = 90
VALID_RAILS = {"ach", "fednow", "fedwire", "rtp"}

def _db() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is not configured")
    return value

def _ensure_schema() -> None:
    with psycopg.connect(_db(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS governance_activity (
                    id bigserial PRIMARY KEY,
                    event_id text NOT NULL UNIQUE,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    run_id text,
                    correlation_id text,
                    operator_id text,
                    operator_name text,
                    rail text,
                    scenario text,
                    activity_type text NOT NULL,
                    agent_name text,
                    command_type text,
                    command text,
                    evidence_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
                    result_summary text,
                    status text NOT NULL DEFAULT 'COMPLETED',
                    proposed_action text,
                    human_approval_required boolean NOT NULL DEFAULT false,
                    escalation_target text,
                    model text,
                    token_usage jsonb,
                    latency_ms integer,
                    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
                );
                CREATE INDEX IF NOT EXISTS governance_activity_created_idx
                    ON governance_activity (created_at DESC);
                CREATE INDEX IF NOT EXISTS governance_activity_rail_idx
                    ON governance_activity (rail, created_at DESC);
                CREATE INDEX IF NOT EXISTS governance_activity_operator_idx
                    ON governance_activity (operator_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS governance_activity_type_idx
                    ON governance_activity (activity_type, created_at DESC);
                DELETE FROM governance_activity
                WHERE created_at < now() - interval '90 days';
            """)

def log_activity(
    *,
    activity_type: str,
    agent_name: str | None = None,
    command_type: str | None = None,
    command: str | None = None,
    evidence_sources: list[str] | None = None,
    result_summary: str | None = None,
    status: str = "COMPLETED",
    proposed_action: str | None = None,
    human_approval_required: bool = False,
    escalation_target: str | None = None,
    rail: str | None = None,
    scenario: str | None = None,
    run_id: str | None = None,
    correlation_id: str | None = None,
    operator_id: str | None = None,
    operator_name: str | None = None,
    model: str | None = None,
    token_usage: dict[str, Any] | None = None,
    latency_ms: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Persist observable agent activity. Stores commands/evidence/results, never hidden chain-of-thought."""
    _ensure_schema()
    event_id = f"gov_{uuid.uuid4().hex[:16]}"
    normalized_rail = rail.lower() if rail else None
    with psycopg.connect(_db(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO governance_activity
                   (event_id,run_id,correlation_id,operator_id,operator_name,rail,scenario,
                    activity_type,agent_name,command_type,command,evidence_sources,result_summary,
                    status,proposed_action,human_approval_required,escalation_target,model,
                    token_usage,latency_ms,metadata)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    event_id, run_id, correlation_id, operator_id, operator_name, normalized_rail,
                    scenario, activity_type, agent_name, command_type, command,
                    Jsonb(evidence_sources or []), result_summary, status, proposed_action,
                    human_approval_required, escalation_target, model,
                    Jsonb(token_usage or {}), latency_ms, Jsonb(metadata or {}),
                ),
            )
    return event_id

def _dates(start_date: str | None, end_date: str | None) -> tuple[date, date]:
    today = datetime.now(timezone.utc).date()
    earliest = today - timedelta(days=RETENTION_DAYS - 1)
    try:
        start = date.fromisoformat(start_date) if start_date else max(earliest, today - timedelta(days=6))
        end = date.fromisoformat(end_date) if end_date else today
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD") from exc
    if start > end:
        raise HTTPException(status_code=400, detail="Start date must be on or before end date")
    if start < earliest:
        raise HTTPException(status_code=400, detail=f"Governance activity is retained for {RETENTION_DAYS} days")
    if end > today:
        raise HTTPException(status_code=400, detail="End date cannot be in the future")
    if (end - start).days >= RETENTION_DAYS:
        raise HTTPException(status_code=400, detail=f"Date range cannot exceed {RETENTION_DAYS} days")
    return start, end

def _where(
    start: date,
    end: date,
    rail: str | None,
    activity_filter: str | None,
    operator_id: str | None,
    status: str | None,
) -> tuple[str, list[Any]]:
    clauses = [
        "created_at >= %s::date",
        "created_at < (%s::date + interval '1 day')",
        "created_at >= now() - interval '90 days'",
    ]
    params: list[Any] = [start.isoformat(), end.isoformat()]
    if rail and rail != "all":
        if rail.lower() not in VALID_RAILS:
            raise HTTPException(status_code=400, detail="Unknown rail")
        clauses.append("rail=%s")
        params.append(rail.lower())
    if operator_id:
        clauses.append("operator_id=%s")
        params.append(operator_id)
    if status:
        clauses.append("status=%s")
        params.append(status)
    if activity_filter and activity_filter != "all":
        if activity_filter == "agents":
            clauses.append("activity_type IN ('AGENT_COMMAND','AGENT_SYNTHESIS','RUNBOOK_AGENT')")
        elif activity_filter == "chatty":
            clauses.append("activity_type='CHAT'")
        elif activity_filter == "approvals":
            clauses.append("activity_type='HUMAN_APPROVAL'")
        elif activity_filter == "escalations":
            clauses.append("escalation_target IS NOT NULL")
        else:
            raise HTTPException(status_code=400, detail="Unknown activity filter")
    return " AND ".join(clauses), params

@router.get("/activity")
def activity(
    start_date: str | None = None,
    end_date: str | None = None,
    rail: str | None = Query(default="all"),
    activity_filter: str | None = Query(default="all"),
    operator_id: str | None = None,
    status: str | None = None,
    limit: int = Query(default=500, ge=1, le=2000),
) -> dict[str, Any]:
    try:
        _ensure_schema()
        start, end = _dates(start_date, end_date)
        where, params = _where(start, end, rail, activity_filter, operator_id, status)
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""SELECT event_id,created_at,run_id,correlation_id,operator_id,operator_name,
                               rail,scenario,activity_type,agent_name,command_type,command,
                               evidence_sources,result_summary,status,proposed_action,
                               human_approval_required,escalation_target,model,token_usage,
                               latency_ms,metadata
                        FROM governance_activity
                        WHERE {where}
                        ORDER BY created_at DESC
                        LIMIT %s""",
                    [*params, limit],
                )
                rows = []
                for row in cur.fetchall():
                    item = dict(row)
                    item["created_at"] = item["created_at"].isoformat()
                    rows.append(item)

                cur.execute(
                    f"""SELECT
                           COUNT(*) AS total_events,
                           COUNT(*) FILTER (WHERE activity_type IN ('AGENT_COMMAND','AGENT_SYNTHESIS','RUNBOOK_AGENT')) AS agent_commands,
                           COUNT(*) FILTER (WHERE activity_type='CHAT') AS chat_exchanges,
                           COUNT(*) FILTER (WHERE activity_type='HUMAN_APPROVAL') AS human_approvals,
                           COUNT(*) FILTER (WHERE escalation_target IS NOT NULL) AS escalations,
                           COUNT(DISTINCT operator_id) FILTER (WHERE operator_id IS NOT NULL) AS operators,
                           COUNT(DISTINCT rail) FILTER (WHERE rail IS NOT NULL) AS rails
                        FROM governance_activity
                        WHERE {where}""",
                    params,
                )
                summary = dict(cur.fetchone())
        return {
            "retention_days": RETENTION_DAYS,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "summary": summary,
            "activity": rows,
        }
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.get("/export")
def export_activity(
    start_date: str | None = None,
    end_date: str | None = None,
    rail: str | None = Query(default="all"),
    activity_filter: str | None = Query(default="all"),
    operator_id: str | None = None,
    status: str | None = None,
) -> Response:
    try:
        _ensure_schema()
        start, end = _dates(start_date, end_date)
        where, params = _where(start, end, rail, activity_filter, operator_id, status)
        with psycopg.connect(_db(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""SELECT created_at,event_id,run_id,operator_name,operator_id,rail,scenario,
                               activity_type,agent_name,command_type,command,evidence_sources,
                               result_summary,status,proposed_action,human_approval_required,
                               escalation_target,model,latency_ms
                        FROM governance_activity
                        WHERE {where}
                        ORDER BY created_at ASC""",
                    params,
                )
                rows = [dict(r) for r in cur.fetchall()]

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Timestamp UTC","Event ID","Run ID","Operator","Operator ID","Rail","Scenario",
            "Activity Type","Agent","Command Type","Command","Evidence Sources","Result Summary",
            "Status","Proposed Action","Human Approval Required","Escalation Target","Model","Latency ms"
        ])
        for row in rows:
            writer.writerow([
                row["created_at"].isoformat(),
                row["event_id"],
                row.get("run_id") or "",
                row.get("operator_name") or "",
                row.get("operator_id") or "",
                (row.get("rail") or "").upper(),
                row.get("scenario") or "",
                row.get("activity_type") or "",
                row.get("agent_name") or "",
                row.get("command_type") or "",
                row.get("command") or "",
                " | ".join(row.get("evidence_sources") or []),
                row.get("result_summary") or "",
                row.get("status") or "",
                row.get("proposed_action") or "",
                "Yes" if row.get("human_approval_required") else "No",
                row.get("escalation_target") or "",
                row.get("model") or "",
                row.get("latency_ms") if row.get("latency_ms") is not None else "",
            ])

        filename = f"payments-governance-{start.isoformat()}-to-{end.isoformat()}.csv"
        return Response(
            content=output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
