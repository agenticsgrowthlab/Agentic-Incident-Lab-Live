from __future__ import annotations

from typing import Any

from crewai import Agent, Crew, LLM, Process, Task

from .core import MODEL, RESPONSE_CONTRACT, agent_record, evidence_text, normalize_recommendation, parse_json


def run(incident: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    llm = LLM(model=f"openai/{MODEL}", temperature=0.1)
    context = evidence_text(evidence)
    definitions = [
        ("Payments SME", "Rail & settlement", "Determine settlement exposure, processing-window constraints, and duplicate-payment risk."),
        ("Platform Agent", "API & queue health", "Diagnose timeouts, retry amplification, queues, dependencies, and safe containment."),
        ("Scout", "Customer impact", "Quantify customer impact, retry behavior, communication needs, and experience risk."),
        ("Risk Agent", "Controls & compliance", "Evaluate approvals, auditability, privacy, idempotency, and compliance controls."),
    ]
    agents = [Agent(role=role, goal=goal, backstory=f"You are the {role} on a regulated payments incident team.", llm=llm, verbose=False, allow_delegation=False) for role, _, goal in definitions]
    tasks = [
        Task(
            description=f"Analyze this incident from your specialty. Use only the evidence supplied.\nINCIDENT\n{incident}\n\nEVIDENCE\n{context}",
            expected_output="A concise 2-3 sentence finding and immediate implication.",
            agent=agent,
        )
        for agent in agents
    ]
    commander = Agent(
        role="Incident Commander",
        goal="Produce an evidence-grounded, safe response requiring human approval",
        backstory="You are Lindsay, accountable for coordinating regulated payments incidents.",
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )
    final_task = Task(
        description=f"Reconcile every specialist finding for the incident below. Prefer evidence over speculation.\nINCIDENT\n{incident}\n\nEVIDENCE\n{context}\n\n{RESPONSE_CONTRACT}",
        expected_output="Only the requested JSON object.",
        agent=commander,
        context=tasks,
    )
    crew = Crew(agents=[*agents, commander], tasks=[*tasks, final_task], process=Process.sequential, verbose=False)
    output = crew.kickoff()
    payload = parse_json(str(output.raw))
    records = [
        agent_record(role, specialty, task.output.raw if task.output else "No finding returned")
        for (role, specialty, _), task in zip(definitions, tasks)
    ]
    recommendation = normalize_recommendation(payload, evidence)
    usage_metrics = getattr(output, "token_usage", None) or getattr(output, "usage_metrics", None)
    token_usage = {
        "input_tokens": int(getattr(usage_metrics, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(usage_metrics, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(usage_metrics, "total_tokens", 0) or 0),
    }
    return {
        "model": MODEL,
        "agents": [agent_record("Lindsay", "Incident Commander", recommendation["rationale"]), *records],
        "recommendation": recommendation,
        "token_usage": token_usage,
    }
