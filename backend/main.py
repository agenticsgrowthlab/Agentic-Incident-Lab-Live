from __future__ import annotations

import asyncio
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from agentic import autogen_runner, crewai_runner, langgraph_runner
from agentic.core import client
from agentic.retrieval import ingest_uploaded_document, list_uploaded_documents, retrieve
from operations import router as operations_router
from ach_ai import router as ach_ai_router
from rail_runbook import router as rail_runbook_router
from governance import router as governance_router
from payments_ops_ai import router as payments_ops_ai_router
from prompt_registry import router as prompt_registry_router
from multi_rail import router as multi_rail_router

app = FastAPI(title="Agentic Incident Lab API", version="1.1.0")
app.include_router(operations_router)
app.include_router(ach_ai_router)
app.include_router(rail_runbook_router)
app.include_router(governance_router)
app.include_router(payments_ops_ai_router)
app.include_router(prompt_registry_router)
app.include_router(multi_rail_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class AnalysisRequest(BaseModel):
    framework: Literal["LangGraph", "CrewAI", "AutoGen"] = "LangGraph"
    incident: str = Field(min_length=20, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    screen_context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)


class IncidentSaveRequest(BaseModel):
    incident_name: str = Field(min_length=3, max_length=160)
    incident_text: str = Field(min_length=20, max_length=12000)
    severity: str = Field(default="SEV-2", max_length=30)
    status: str = Field(default="Investigating", max_length=40)
    framework: Literal["LangGraph", "CrewAI", "AutoGen"]
    analysis: dict[str, Any]
    human_approved: bool = False
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    final_root_cause: str | None = None
    resolution: str | None = None
    lessons_learned: str | None = None


class IncidentUpdateRequest(BaseModel):
    incident_name: str | None = Field(default=None, min_length=3, max_length=160)
    incident_text: str | None = Field(default=None, min_length=20, max_length=12000)
    severity: str | None = Field(default=None, max_length=30)
    status: str | None = Field(default=None, max_length=40)
    framework: Literal["LangGraph", "CrewAI", "AutoGen"] | None = None
    analysis: dict[str, Any] | None = None
    human_approved: bool | None = None
    attachments: list[dict[str, Any]] | None = None
    final_root_cause: str | None = None
    resolution: str | None = None
    lessons_learned: str | None = None


def _database_url() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is not configured")
    return value


def _ensure_incident_table() -> None:
    import psycopg

    with psycopg.connect(_database_url(), autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS incident_records (
                    id text PRIMARY KEY,
                    incident_name text NOT NULL,
                    incident_text text NOT NULL,
                    severity text NOT NULL,
                    status text NOT NULL,
                    framework text NOT NULL,
                    analysis jsonb NOT NULL,
                    human_approved boolean NOT NULL DEFAULT false,
                    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
                    final_root_cause text,
                    resolution text,
                    lessons_learned text,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )


def _incident_id() -> str:
    return f"INC-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:5].upper()}"


def _incident_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "incident_name": row[1],
        "incident_text": row[2],
        "severity": row[3],
        "status": row[4],
        "framework": row[5],
        "analysis": row[6],
        "human_approved": row[7],
        "attachments": row[8] or [],
        "final_root_cause": row[9],
        "resolution": row[10],
        "lessons_learned": row[11],
        "created_at": row[12].isoformat() if row[12] else None,
        "updated_at": row[13].isoformat() if row[13] else None,
    }


def _public_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": item["id"],
            "title": item["title"],
            "type": item["type"],
            "score": round(float(item["score"]), 3),
            "excerpt": " ".join(item["content"].replace("#", "").split())[:280],
        }
        for item in items
    ]


async def analyze(payload: AnalysisRequest) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured")

    started = time.perf_counter()
    evidence, retrieval_mode, retrieval_notice = await asyncio.to_thread(retrieve, payload.incident)
    if payload.framework == "LangGraph":
        result = await asyncio.to_thread(langgraph_runner.run, payload.incident, evidence)
    elif payload.framework == "CrewAI":
        result = await asyncio.to_thread(crewai_runner.run, payload.incident, evidence)
    else:
        result = await autogen_runner.run(payload.incident, evidence)

    latency_ms = round((time.perf_counter() - started) * 1000)
    cited = len(result["recommendation"].get("evidence_used", []))
    result.update(
        {
            "run_id": f"run_{uuid.uuid4().hex[:12]}",
            "framework": payload.framework,
            "latency_ms": latency_ms,
            "retrieval_mode": retrieval_mode,
            "retrieval_notice": retrieval_notice,
            "evidence": _public_evidence(evidence),
            "citation_coverage": round(cited / max(1, len(evidence)), 2),
            "live": True,
        }
    )
    return result


@app.get("/api/analyze")
async def health() -> dict[str, Any]:
    return {
        "service": "Agentic Incident Lab",
        "status": "ready" if os.getenv("OPENAI_API_KEY") else "configuration_required",
        "configured": bool(os.getenv("OPENAI_API_KEY")),
        "vector_database_configured": bool(os.getenv("DATABASE_URL")),
        "incident_store_configured": bool(os.getenv("DATABASE_URL")),
        "frameworks": ["LangGraph", "CrewAI", "AutoGen"],
    }


@app.post("/api/analyze")
async def run_analysis(payload: AnalysisRequest) -> dict[str, Any]:
    try:
        return await analyze(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/api/incidents")
async def save_incident(payload: IncidentSaveRequest) -> dict[str, Any]:
    try:
        import psycopg

        _ensure_incident_table()
        incident_id = _incident_id()
        with psycopg.connect(_database_url(), autocommit=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO incident_records
                    (id, incident_name, incident_text, severity, status, framework, analysis,
                     human_approved, attachments, final_root_cause, resolution, lessons_learned)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING id, incident_name, incident_text, severity, status, framework,
                              analysis, human_approved, attachments, final_root_cause,
                              resolution, lessons_learned, created_at, updated_at
                    """,
                    (
                        incident_id,
                        payload.incident_name,
                        payload.incident_text,
                        payload.severity,
                        payload.status,
                        payload.framework,
                        Jsonb(payload.analysis),
                        payload.human_approved,
                        Jsonb(payload.attachments),
                        payload.final_root_cause,
                        payload.resolution,
                        payload.lessons_learned,
                    ),
                )
                return _incident_row(cursor.fetchone())
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/incidents")
async def list_incidents() -> list[dict[str, Any]]:
    try:
        import psycopg

        _ensure_incident_table()
        with psycopg.connect(_database_url(), autocommit=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, incident_name, incident_text, severity, status, framework,
                           analysis, human_approved, attachments, final_root_cause,
                           resolution, lessons_learned, created_at, updated_at
                    FROM incident_records
                    ORDER BY created_at DESC
                    LIMIT 250
                    """
                )
                return [_incident_row(row) for row in cursor.fetchall()]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/incidents/{incident_id}")
async def get_incident(incident_id: str) -> dict[str, Any]:
    try:
        import psycopg

        _ensure_incident_table()
        with psycopg.connect(_database_url(), autocommit=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, incident_name, incident_text, severity, status, framework,
                           analysis, human_approved, attachments, final_root_cause,
                           resolution, lessons_learned, created_at, updated_at
                    FROM incident_records WHERE id=%s
                    """,
                    (incident_id,),
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Incident not found")
                return _incident_row(row)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.patch("/api/incidents/{incident_id}")
async def update_incident(incident_id: str, payload: IncidentUpdateRequest) -> dict[str, Any]:
    try:
        import psycopg

        _ensure_incident_table()
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return await get_incident(incident_id)

        column_map = {
            "incident_name": "incident_name",
            "incident_text": "incident_text",
            "severity": "severity",
            "status": "status",
            "framework": "framework",
            "analysis": "analysis",
            "human_approved": "human_approved",
            "attachments": "attachments",
            "final_root_cause": "final_root_cause",
            "resolution": "resolution",
            "lessons_learned": "lessons_learned",
        }
        assignments: list[str] = []
        values: list[Any] = []
        for key, value in updates.items():
            assignments.append(f"{column_map[key]}=%s")
            if key in {"analysis", "attachments"} and value is not None:
                value = Jsonb(value)
            values.append(value)
        assignments.append("updated_at=now()")
        values.append(incident_id)

        with psycopg.connect(_database_url(), autocommit=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    UPDATE incident_records SET {", ".join(assignments)}
                    WHERE id=%s
                    RETURNING id, incident_name, incident_text, severity, status, framework,
                              analysis, human_approved, attachments, final_root_cause,
                              resolution, lessons_learned, created_at, updated_at
                    """,
                    values,
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Incident not found")
                return _incident_row(row)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/knowledge/upload")
async def upload_knowledge(
    file: UploadFile = File(...),
    doc_type: str = Form("INCIDENT_EVIDENCE"),
    incident_id: str | None = Form(None),
) -> dict[str, Any]:
    try:
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File exceeds the 10 MB limit")

        return await asyncio.to_thread(
            ingest_uploaded_document,
            filename=file.filename or "uploaded-document",
            content_type=file.content_type or "application/octet-stream",
            raw=raw,
            doc_type=doc_type,
            incident_id=incident_id,
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/knowledge")
async def knowledge_documents() -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(list_uploaded_documents)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


def _recent_incidents_for_chat(limit: int = 40) -> list[dict[str, Any]]:
    import psycopg

    _ensure_incident_table()
    with psycopg.connect(_database_url(), autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, incident_name, incident_text, severity, status, framework,
                       analysis, human_approved, attachments, final_root_cause,
                       resolution, lessons_learned, created_at, updated_at
                FROM incident_records
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            return [_incident_row(row) for row in cursor.fetchall()]


def _incident_match_score(query: str, incident: dict[str, Any]) -> int:
    query_tokens = {
        token.lower()
        for token in query.replace("/", " ").replace("-", " ").split()
        if len(token) >= 3
    }
    haystack = " ".join(
        [
            incident.get("incident_name") or "",
            incident.get("incident_text") or "",
            incident.get("severity") or "",
            str((incident.get("analysis") or {}).get("recommendation") or ""),
        ]
    ).lower()
    return sum(1 for token in query_tokens if token in haystack)


@app.post("/api/chat")
async def chat_with_incident_lab(payload: ChatRequest) -> dict[str, Any]:
    try:
        incidents = await asyncio.to_thread(_recent_incidents_for_chat)

        current_text = " ".join(
            [
                str(payload.screen_context.get("incident_name") or ""),
                str(payload.screen_context.get("incident_text") or ""),
                payload.message,
            ]
        )
        ranked = sorted(
            incidents,
            key=lambda item: _incident_match_score(current_text, item),
            reverse=True,
        )
        matches = [
            item for item in ranked
            if _incident_match_score(current_text, item) > 0
        ][:5]

        # Retrieve indexed RCA/data-model/knowledge evidence using the current incident + question.
        evidence, retrieval_mode, retrieval_notice = await asyncio.to_thread(
            retrieve, current_text[:4000]
        )

        incident_context = [
            {
                "id": item["id"],
                "incident_name": item["incident_name"],
                "incident_text": item["incident_text"],
                "severity": item["severity"],
                "status": item["status"],
                "framework": item["framework"],
                "created_at": item["created_at"],
                "updated_at": item["updated_at"],
                "final_root_cause": item.get("final_root_cause"),
                "resolution": item.get("resolution"),
                "lessons_learned": item.get("lessons_learned"),
                "recommendation": (item.get("analysis") or {}).get("recommendation"),
                "agents": (item.get("analysis") or {}).get("agents", []),
            }
            for item in incidents[:25]
        ]

        evidence_context = [
            {
                "id": item["id"],
                "title": item["title"],
                "type": item["type"],
                "score": round(float(item["score"]), 3),
                "content": item["content"][:1800],
            }
            for item in evidence[:6]
        ]

        system_prompt = """
You are Chatty, the live incident troubleshooting assistant inside Agentic Incident Lab.
Your job is to help payment operations teams investigate safely under pressure.

You can use:
1. the user's current on-screen incident context,
2. historical incidents from Neon,
3. retrieved RCA/runbook/data-model evidence from Neon pgvector.

Rules:
- Be concise and operational.
- Distinguish observed facts from hypotheses.
- Never claim a past incident is the same unless the evidence supports it.
- If asked "has this happened before?", identify the strongest historical match(es), explain why, and use their incident IDs.
- Suggest the next 2-4 checks when troubleshooting.
- Do not authorize or execute payment actions.
- Do not invent processor responses, transaction states, or compliance facts.
"""

        user_payload = {
            "question": payload.message,
            "screen_context": payload.screen_context,
            "recent_conversation": payload.history[-8:],
            "historical_incidents": incident_context,
            "retrieved_knowledge": evidence_context,
            "retrieval_mode": retrieval_mode,
            "retrieval_notice": retrieval_notice,
        }

        response = await asyncio.to_thread(
            lambda: client().chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": "Use this incident data to answer:\n"
                        + str(user_payload),
                    },
                ],
            )
        )

        answer = response.choices[0].message.content or "No response was generated."

        return {
            "answer": answer,
            "incident_matches": [
                {
                    "id": item["id"],
                    "name": item["incident_name"],
                    "created_at": item["created_at"],
                }
                for item in matches
            ],
            "retrieval_mode": retrieval_mode,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/health")
async def service_health() -> dict[str, str]:
    return {"status": "ok"}
