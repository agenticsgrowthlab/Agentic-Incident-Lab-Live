from __future__ import annotations

import asyncio
import os
import time
import traceback
import uuid
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agentic import autogen_runner, crewai_runner, langgraph_runner
from agentic.retrieval import retrieve

app = FastAPI(title="Agentic Incident Lab API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class AnalysisRequest(BaseModel):
    framework: Literal["LangGraph", "CrewAI", "AutoGen"] = "LangGraph"
    incident: str = Field(min_length=20, max_length=4000)


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


@app.get("/health")
async def service_health() -> dict[str, str]:
    return {"status": "ok"}
