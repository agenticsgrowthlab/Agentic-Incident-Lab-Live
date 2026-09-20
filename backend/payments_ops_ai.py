from __future__ import annotations

import json
import os
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agentic.core import MODEL, call_json, call_text, merge_usage
from ach_ai import TEAM
from rail_runbook import RAIL_LABELS, load_rail_context
from governance import log_activity

router = APIRouter(prefix="/api/payments-ops-ai", tags=["payments-ops-ai"])

TEAM_LOOKUP = {name: (role, focus) for name, role, focus in TEAM}

RAIL_SPECIALISTS = {
    "ach": [
        "Nacha Specialist",
        "Returns Specialist",
        "Account & Authorization Specialist",
        "Processor & Connectivity Specialist",
        "Posting & Core Specialist",
        "Reconciliation Specialist",
        "Risk & Controls Specialist",
    ],
    "fednow": [
        "Returns Specialist",
        "Account & Authorization Specialist",
        "Processor & Connectivity Specialist",
        "Posting & Core Specialist",
        "Reconciliation Specialist",
        "Risk & Controls Specialist",
    ],
    "fedwire": [
        "Returns Specialist",
        "Account & Authorization Specialist",
        "Processor & Connectivity Specialist",
        "Posting & Core Specialist",
        "Reconciliation Specialist",
        "Risk & Controls Specialist",
    ],
    "rtp": [
        "Returns Specialist",
        "Account & Authorization Specialist",
        "Processor & Connectivity Specialist",
        "Posting & Core Specialist",
        "Reconciliation Specialist",
        "Risk & Controls Specialist",
    ],
}

class ChatRequest(BaseModel):
    operator_id: str | None = Field(default=None, max_length=160)
    operator_name: str | None = Field(default=None, max_length=160)
    rail: str = Field(min_length=2, max_length=30)
    scenario: str = Field(default="healthy", max_length=30)
    message: str = Field(min_length=1, max_length=6000)
    transaction_id: str | None = Field(default=None, max_length=160)
    screen_context: dict[str, Any] = Field(default_factory=dict)
    conversation: list[dict[str, str]] = Field(default_factory=list)

class TeamRequest(BaseModel):
    operator_id: str | None = Field(default=None, max_length=160)
    operator_name: str | None = Field(default=None, max_length=160)
    rail: str = Field(min_length=2, max_length=30)
    scenario: str = Field(default="healthy", max_length=30)
    question: str = Field(default="Analyze the current rail health and tell me what the operator should do next.", max_length=6000)
    transaction_id: str | None = Field(default=None, max_length=160)
    screen_context: dict[str, Any] = Field(default_factory=dict)

def _rail(value: str) -> str:
    rail = value.lower()
    if rail not in RAIL_LABELS:
        raise HTTPException(status_code=404, detail="Unknown payment rail")
    return rail

def _context(rail: str, scenario: str, transaction_id: str | None, screen_context: dict[str, Any]) -> str:
    db = load_rail_context(rail, scenario, transaction_id)
    return json.dumps(
        {
            "rail": RAIL_LABELS[rail],
            "scenario": scenario,
            "database_context": db,
            "screen_context": screen_context,
        },
        indent=2,
        default=str,
    )

def _rail_rules(rail: str) -> str:
    if rail == "ach":
        return """ACH-specific guidance:
- Use ACH/Nacha concepts where supported by evidence.
- Distinguish payment outcome, including RETURNED, from operational remediation state.
- Validate file/batch/trace/control totals, acknowledgements, posting, returns/NOCs and settlement/reconciliation.
"""
    if rail == "fednow":
        return """FedNow-specific guidance:
- Treat the rail as an instant-payment, message-based flow.
- Focus on participant reachability, ISO 20022 message lifecycle, immediate status, posting, liquidity/settlement and ambiguous-state retry safety.
- Do not apply ACH/Nacha file rules.
"""
    if rail == "fedwire":
        return """FedWire-specific guidance:
- Treat the rail as high-value wire operations.
- Focus on ISO 20022 message validity, entitlements/dual control, liquidity, acknowledgements/rejections, posting/ledger state, investigations and settlement reconciliation.
- Never recommend blind resend of a high-value wire.
- Do not apply ACH/Nacha file rules.
"""
    return """RTP-specific guidance:
- Treat the rail as a real-time message-based payment flow.
- Focus on participant/switch health, prefunding/liquidity, ISO 20022 lifecycle, immediate posting/status, duplicate protection, returns/investigations and settlement reconciliation.
- Do not apply ACH/Nacha file rules.
"""

@router.post("/chat")
def chat(payload: ChatRequest) -> dict[str, Any]:
    rail = _rail(payload.rail)
    started = time.perf_counter()
    run_id = f"paychat_{__import__('uuid').uuid4().hex[:12]}"
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    try:
        context = _context(rail, payload.scenario, payload.transaction_id, payload.screen_context)
        recent = payload.conversation[-8:]
        history = "\n".join(
            f"{item.get('role','user').upper()}: {item.get('content','')}"
            for item in recent
        )

        response, usage = call_text(
            f"""You are the {RAIL_LABELS[rail]} Payments Ops Copilot inside a payment operations command center.

Your job is to help a human payment-operations SME investigate, reconcile and decide what to do next.
Use ONLY supplied evidence for operational claims. If evidence is absent, say UNKNOWN and state what evidence is needed.
Never interpret missing rows/events as proof of success, resolution or non-impact.
Never claim you executed a payment, file/message release, funding action, account change, compliance decision or retry/replay.
Before recommending retry/replay/resend, require authoritative downstream/network/posting state so duplicate risk is controlled.
Material or systemic incidents should be handed to Incident Intelligence / Lindsay.
The human operator owns consequential action and final approval.

{_rail_rules(rail)}

Be concise but operationally useful. When appropriate structure the answer as:
- What I see
- What it means
- What I would check next
- Safe next action
- Missing evidence / escalation
""",
            f"""CURRENT {RAIL_LABELS[rail]} CONTEXT
{context}

RECENT CONVERSATION
{history or "None"}

OPERATOR QUESTION
{payload.message}""",
        )
        latency_ms = round((time.perf_counter() - started) * 1000)
        log_activity(
            activity_type="CHAT",
            agent_name=f"{RAIL_LABELS[rail]} Ops Copilot",
            command_type="OPERATOR_CHAT",
            command=payload.message,
            evidence_sources=["database rail context", "screen context", "recent conversation"],
            result_summary=response,
            status="COMPLETED",
            proposed_action="Human operator reviews and decides whether to act on the recommendation.",
            human_approval_required=True,
            rail=rail,
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
            "run_id": run_id,
            "rail": rail,
            "label": RAIL_LABELS[rail],
            "message": response,
            "model": MODEL,
            "token_usage": usage,
            "latency_ms": latency_ms,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

@router.post("/team")
def team(payload: TeamRequest) -> dict[str, Any]:
    rail = _rail(payload.rail)
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    started = time.perf_counter()
    run_id = f"payteam_{__import__('uuid').uuid4().hex[:12]}"
    try:
        context = _context(rail, payload.scenario, payload.transaction_id, payload.screen_context)
        findings: list[dict[str, str]] = []
        usages: list[dict[str, Any]] = []

        for name in RAIL_SPECIALISTS[rail]:
            role, focus = TEAM_LOOKUP[name]
            finding, usage = call_text(
                f"""You are {name}, the {role} specialist on a {RAIL_LABELS[rail]} payment operations team.
{focus}

Investigate the supplied question using only supplied evidence.
Missing evidence is UNKNOWN, not success.
Do not claim execution of consequential actions.
For a retry/replay/resend question, require authoritative downstream/network/posting state.
If impact appears material/systemic, recommend handoff to Incident Intelligence / Lindsay.

{_rail_rules(rail)}

Return a compact specialist finding with:
- evidence checked
- finding
- risk/exception
- recommended operator next step
- missing evidence
""",
                f"""RAIL: {RAIL_LABELS[rail]}
QUESTION: {payload.question}

CURRENT EVIDENCE
{context}""",
            )
            normalized_finding = " ".join(finding.split())
            findings.append({
                "name": name,
                "role": role,
                "finding": normalized_finding,
            })
            usages.append(usage)
            log_activity(
                activity_type="AGENT_COMMAND",
                agent_name=name,
                command_type="SPECIALIST_ANALYSIS",
                command=payload.question,
                evidence_sources=["database rail context", "screen context"],
                result_summary=normalized_finding,
                status="COMPLETED",
                proposed_action="Human operator reviews specialist recommendation.",
                human_approval_required=True,
                rail=rail,
                scenario=payload.scenario,
                run_id=run_id,
                operator_id=payload.operator_id,
                operator_name=payload.operator_name,
                model=MODEL,
                token_usage=usage,
                metadata={"transaction_id": payload.transaction_id},
            )

        findings_text = "\n".join(
            f"- {f['name']} ({f['role']}): {f['finding']}" for f in findings
        )

        synthesis, usage = call_json(
            f"""You are the Payments Operations Lead synthesizing a {RAIL_LABELS[rail]} specialist review.
Use only supplied evidence and specialist findings.
Missing evidence is UNKNOWN, never success.
Do not claim consequential actions were executed.
Distinguish rail/network/payment state from operational remediation/reconciliation state.
Require authoritative downstream state before retry/replay/resend.
Escalate material/systemic issues to Incident Intelligence / Lindsay.

{_rail_rules(rail)}

Return JSON exactly:
{{
  "summary": "one paragraph",
  "payment_or_network_state": "known state or UNKNOWN",
  "operations_status": "RESOLVED|UNRESOLVED|NEEDS_ATTENTION|UNKNOWN",
  "likely_cause": "cause or UNKNOWN",
  "recommended_action": "safe next action",
  "why": "short rationale",
  "duplicate_risk": "LOW|MEDIUM|HIGH|UNKNOWN",
  "human_approval_required": true,
  "escalate_to_incident_intelligence": false,
  "escalation_target": "Incident Intelligence / Lindsay or none",
  "missing_evidence": ["item"]
}}
""",
            f"""QUESTION
{payload.question}

CURRENT {RAIL_LABELS[rail]} EVIDENCE
{context}

SPECIALIST FINDINGS
{findings_text}""",
        )
        usages.append(usage)

        if synthesis.get("escalate_to_incident_intelligence"):
            synthesis["escalation_target"] = "Incident Intelligence / Lindsay"

        latency_ms = round((time.perf_counter() - started) * 1000)
        merged_usage = merge_usage(usages)
        log_activity(
            activity_type="AGENT_SYNTHESIS",
            agent_name=f"{RAIL_LABELS[rail]} Payments Operations Lead",
            command_type="TEAM_SYNTHESIS",
            command=payload.question,
            evidence_sources=["specialist findings", "database rail context", "screen context"],
            result_summary=str(synthesis.get("summary") or "Team analysis complete."),
            status=str(synthesis.get("operations_status") or "COMPLETED"),
            proposed_action=str(synthesis.get("recommended_action") or ""),
            human_approval_required=bool(synthesis.get("human_approval_required", True)),
            escalation_target=str(synthesis.get("escalation_target")) if synthesis.get("escalate_to_incident_intelligence") else None,
            rail=rail,
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
            "rail": rail,
            "label": RAIL_LABELS[rail],
            "lead": synthesis,
            "specialists": findings,
            "model": MODEL,
            "token_usage": merged_usage,
            "latency_ms": latency_ms,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
