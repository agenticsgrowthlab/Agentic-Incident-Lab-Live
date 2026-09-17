from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from agentic import autogen_runner, crewai_runner, langgraph_runner
from agentic.retrieval import retrieve


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


async def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    framework = str(payload.get("framework", "LangGraph"))
    incident = str(payload.get("incident", "")).strip()
    if framework not in {"LangGraph", "CrewAI", "AutoGen"}:
        raise ValueError("framework must be LangGraph, CrewAI, or AutoGen")
    if len(incident) < 20:
        raise ValueError("incident must contain at least 20 characters")
    if len(incident) > 4000:
        raise ValueError("incident must contain no more than 4000 characters")
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured")

    started = time.perf_counter()
    evidence, retrieval_mode, retrieval_notice = await asyncio.to_thread(retrieve, incident)
    if framework == "LangGraph":
        result = await asyncio.to_thread(langgraph_runner.run, incident, evidence)
    elif framework == "CrewAI":
        result = await asyncio.to_thread(crewai_runner.run, incident, evidence)
    else:
        result = await autogen_runner.run(incident, evidence)
    latency_ms = round((time.perf_counter() - started) * 1000)
    cited = len(result["recommendation"].get("evidence_used", []))
    result.update(
        {
            "run_id": f"run_{uuid.uuid4().hex[:12]}",
            "framework": framework,
            "latency_ms": latency_ms,
            "retrieval_mode": retrieval_mode,
            "retrieval_notice": retrieval_notice,
            "evidence": _public_evidence(evidence),
            "citation_coverage": round(cited / max(1, len(evidence)), 2),
            "live": True,
        }
    )
    return result


class handler(BaseHTTPRequestHandler):
    def _headers(self, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _write(self, payload: dict[str, Any], status: int = 200):
        self._headers(status)
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        self._write(
            {
                "service": "Agentic Incident Lab",
                "status": "ready" if os.getenv("OPENAI_API_KEY") else "configuration_required",
                "configured": bool(os.getenv("OPENAI_API_KEY")),
                "vector_database_configured": bool(os.getenv("DATABASE_URL")),
                "frameworks": ["LangGraph", "CrewAI", "AutoGen"],
            }
        )

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 20_000:
                self._write({"error": "Request is too large"}, 413)
                return
            body = json.loads(self.rfile.read(length) or b"{}")
            self._write(asyncio.run(analyze(body)))
        except ValueError as exc:
            self._write({"error": str(exc), "code": "invalid_request"}, 400)
        except RuntimeError as exc:
            self._write({"error": str(exc), "code": "configuration_required"}, 503)
        except Exception as exc:
            print(traceback.format_exc())
            self._write({"error": "The live agent run failed", "detail": f"{type(exc).__name__}: {exc}", "code": "agent_run_failed"}, 500)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    print(f"Agent API listening on http://localhost:{port}/api/analyze")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
