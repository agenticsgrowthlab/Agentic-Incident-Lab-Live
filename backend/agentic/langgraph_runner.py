from __future__ import annotations

import operator
from typing import Annotated, Any

from typing_extensions import TypedDict
from langgraph.graph import END, START, StateGraph

from .core import MODEL, RESPONSE_CONTRACT, agent_record, call_json, call_text, evidence_text, merge_usage, normalize_recommendation


class IncidentState(TypedDict):
    incident: str
    evidence: list[dict[str, Any]]
    agents: Annotated[list[dict[str, str]], operator.add]
    usage: Annotated[list[dict[str, int]], operator.add]
    recommendation: dict[str, Any]


def run(incident: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    context = evidence_text(evidence)

    def specialist(name: str, role: str, focus: str):
        def node(state: IncidentState):
            finding, usage = call_text(
                f"You are {name}, the {role} in a regulated payments incident team. {focus} Be concise, evidence-led, and do not invent facts.",
                f"INCIDENT\n{state['incident']}\n\nRETRIEVED EVIDENCE\n{context}\n\nProvide your strongest finding and the immediate implication in 2-3 sentences.",
            )
            return {"agents": [agent_record(name, role, finding)], "usage": [usage]}
        return node

    def synthesize(state: IncidentState):
        findings = "\n".join(f"- {item['name']} ({item['role']}): {item['finding']}" for item in state["agents"])
        payload, usage = call_json(
            "You are Lindsay, the accountable incident commander. Reconcile the specialists, prefer cited evidence over speculation, and require human approval for consequential action.",
            f"INCIDENT\n{incident}\n\nEVIDENCE\n{context}\n\nSPECIALIST FINDINGS\n{findings}\n\n{RESPONSE_CONTRACT}",
        )
        return {"recommendation": normalize_recommendation(payload, evidence), "usage": [usage]}

    graph = StateGraph(IncidentState)
    graph.add_node("payments", specialist("Payments SME", "Rail & settlement", "Assess ACH windows, settlement exposure, and duplicate-payment risk."))
    graph.add_node("platform", specialist("Platform Agent", "API & queue health", "Assess timeouts, retries, queues, dependencies, and safe containment."))
    graph.add_node("scout", specialist("Scout", "Customer impact", "Assess affected customers, retry behavior, communications, and measurable impact."))
    graph.add_node("risk", specialist("Risk Agent", "Controls & compliance", "Assess approval, auditability, idempotency, privacy, and regulatory controls."))
    graph.add_node("synthesize", synthesize)
    graph.add_edge(START, "payments")
    graph.add_edge("payments", "platform")
    graph.add_edge("platform", "scout")
    graph.add_edge("scout", "risk")
    graph.add_edge("risk", "synthesize")
    graph.add_edge("synthesize", END)
    result = graph.compile().invoke({"incident": incident, "evidence": evidence, "agents": [], "usage": [], "recommendation": {}})
    agents = [agent_record("Lindsay", "Incident Commander", result["recommendation"]["rationale"]), *result["agents"]]
    return {"model": MODEL, "agents": agents, "recommendation": result["recommendation"], "token_usage": merge_usage(result["usage"])}
