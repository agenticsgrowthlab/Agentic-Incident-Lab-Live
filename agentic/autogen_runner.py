from __future__ import annotations

import os
from typing import Any

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import MaxMessageTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_ext.models.openai import OpenAIChatCompletionClient

from .core import MODEL, RESPONSE_CONTRACT, agent_record, evidence_text, normalize_recommendation, parse_json


async def run(incident: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    context = evidence_text(evidence)
    model_client = OpenAIChatCompletionClient(model=MODEL, api_key=os.environ["OPENAI_API_KEY"], temperature=0.1)
    roles = [
        ("payments_sme", "Payments SME", "Rail & settlement", "Analyze settlement exposure, processing windows, and duplicate-payment risk."),
        ("platform_agent", "Platform Agent", "API & queue health", "Analyze timeouts, retry amplification, queues, dependencies, and containment."),
        ("risk_and_customer", "Risk Agent", "Controls & customer impact", "Analyze customer impact, approvals, idempotency, privacy, and compliance."),
        ("incident_commander", "Lindsay", "Incident Commander", f"Reconcile the preceding specialists. Return only final JSON. {RESPONSE_CONTRACT}"),
    ]
    participants = [
        AssistantAgent(name, model_client=model_client, system_message=f"You are {display_name}, the {role} on a regulated payments incident team. {instruction} Use only supplied evidence and do not invent facts.")
        for name, display_name, role, instruction in roles
    ]
    # The task itself is the first message, so five messages gives each of the
    # four agents exactly one bounded turn and leaves Lindsay as the final turn.
    team = RoundRobinGroupChat(participants, termination_condition=MaxMessageTermination(max_messages=5))
    task = f"INCIDENT\n{incident}\n\nRETRIEVED EVIDENCE\n{context}\n\nEach specialist should provide a concise finding. The Incident Commander must produce the final response contract."
    try:
        result = await team.run(task=task)
        messages = [message for message in result.messages if getattr(message, "source", "") != "user"]
        final_content = str(getattr(messages[-1], "content", "{}")) if messages else "{}"
        recommendation = normalize_recommendation(parse_json(final_content), evidence)
        records = []
        input_tokens = output_tokens = 0
        role_lookup = {name: (display_name, role) for name, display_name, role, _ in roles}
        for message in messages:
            source = getattr(message, "source", "")
            display_name, role = role_lookup.get(source, (source, "Agent"))
            content = getattr(message, "content", "")
            if source != "incident_commander":
                records.append(agent_record(display_name, role, str(content)))
            usage = getattr(message, "models_usage", None)
            input_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
            output_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
    finally:
        await model_client.close()
    return {
        "model": MODEL,
        "agents": [agent_record("Lindsay", "Incident Commander", recommendation["rationale"]), *records],
        "recommendation": recommendation,
        "token_usage": {"input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": input_tokens + output_tokens},
    }
