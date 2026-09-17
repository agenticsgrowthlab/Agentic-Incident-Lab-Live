from __future__ import annotations

import json
import os
import re
from typing import Any

from openai import OpenAI

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

AGENT_ROLES = [
    ("Lindsay", "Incident Commander"),
    ("Payments SME", "Rail & settlement"),
    ("Platform Agent", "API & queue health"),
    ("Scout", "Customer impact"),
    ("Risk Agent", "Controls & compliance"),
]

RESPONSE_CONTRACT = """
Return only a valid JSON object with exactly this shape:
{
  "recommendation": {
    "summary": "one precise immediate action",
    "likely_cause": "most likely cause",
    "primary_control": "control that prevents added harm",
    "escalation": "accountable team",
    "confidence": 0.0,
    "rationale": "brief evidence-based explanation",
    "human_approval_required": true,
    "evidence_used": ["document id"]
  }
}
Confidence must be between 0 and 1. Cite only document ids present in the evidence.
""".strip()


def client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return OpenAI(api_key=api_key)


def _usage(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    if not usage:
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": int(getattr(usage, "total_tokens", input_tokens + output_tokens) or 0),
    }


def call_text(system: str, user: str) -> tuple[str, dict[str, int]]:
    response = client().chat.completions.create(
        model=MODEL,
        temperature=0.1,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return response.choices[0].message.content or "", _usage(response)


def call_json(system: str, user: str) -> tuple[dict[str, Any], dict[str, int]]:
    response = client().chat.completions.create(
        model=MODEL,
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    content = response.choices[0].message.content or "{}"
    return parse_json(content), _usage(response)


def parse_json(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", value, re.DOTALL)
        if not match:
            raise ValueError("The model did not return valid JSON")
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}


def evidence_text(evidence: list[dict[str, Any]]) -> str:
    return "\n\n".join(
        f"[{item['id']}] {item['title']} ({item['type']}, similarity {item['score']:.2f})\n{item['content']}"
        for item in evidence
    )


def normalize_recommendation(payload: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
    source = payload.get("recommendation", payload)
    valid_ids = {item["id"] for item in evidence}
    evidence_used = [item for item in source.get("evidence_used", []) if item in valid_ids]
    try:
        confidence = max(0.0, min(1.0, float(source.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "summary": str(source.get("summary", "Escalate for human review.")),
        "likely_cause": str(source.get("likely_cause", "Insufficient evidence")),
        "primary_control": str(source.get("primary_control", "Preserve current controls")),
        "escalation": str(source.get("escalation", "Incident Commander")),
        "confidence": confidence,
        "rationale": str(source.get("rationale", "Review the retrieved evidence before acting.")),
        "human_approval_required": bool(source.get("human_approval_required", True)),
        "evidence_used": evidence_used,
    }


def merge_usage(records: list[dict[str, int]]) -> dict[str, int]:
    return {
        key: sum(int(record.get(key, 0)) for record in records)
        for key in ("input_tokens", "output_tokens", "total_tokens")
    }


def agent_record(name: str, role: str, finding: str) -> dict[str, str]:
    clean = " ".join(str(finding).strip().split())
    return {"name": name, "role": role, "finding": clean[:520], "status": "complete"}
