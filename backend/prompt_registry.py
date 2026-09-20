from __future__ import annotations

import ast
import hashlib
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/prompts", tags=["prompt-registry"])

BASE = Path(__file__).resolve().parent

# Deliberately allowlisted: prompt-bearing application files only.
INCIDENT_FILES = [
    BASE / "main.py",
    BASE / "agentic" / "langgraph_runner.py",
    BASE / "agentic" / "crewai_runner.py",
    BASE / "agentic" / "autogen_runner.py",
]

PLATFORM_FILES = [
    BASE / "payments_ops_ai.py",
    BASE / "ach_ai.py",
    BASE / "rail_runbook.py",
]

PROMPT_CALLS = {"call_text", "call_json"}
PROMPT_KWARGS = {
    "system_message",
    "backstory",
    "goal",
    "description",
    "expected_output",
    "task",
}

def _expr_text(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        # ast.unparse preserves f-string placeholders, which is what we want:
        # exact active source template, not a fabricated runtime example.
        return ast.unparse(node)
    except Exception:
        return "<unable to render source expression>"

def _function_for_line(tree: ast.AST, line: int) -> str:
    best = ("module", -1)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            start = getattr(node, "lineno", -1)
            end = getattr(node, "end_lineno", start)
            if start <= line <= end and start > best[1]:
                best = (node.name, start)
    return best[0]

def _call_name(node: ast.Call) -> str:
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return "call"

def _records_for_file(path: Path, scope: str) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    rel = str(path.relative_to(BASE)).replace("\\", "/")
    records: list[dict[str, Any]] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        call = _call_name(node)
        line = getattr(node, "lineno", 0)
        function = _function_for_line(tree, line)
        prompts: list[tuple[str, ast.AST]] = []

        # OpenAI wrappers: first positional arg is system prompt, second is user/runtime template.
        if call in PROMPT_CALLS:
            if len(node.args) >= 1:
                prompts.append(("system", node.args[0]))
            if len(node.args) >= 2:
                prompts.append(("runtime_template", node.args[1]))

        # CrewAI / AutoGen prompt-bearing keyword arguments.
        for kw in node.keywords:
            if kw.arg in PROMPT_KWARGS and kw.value is not None:
                prompts.append((kw.arg, kw.value))

        for prompt_type, expr in prompts:
            rendered = _expr_text(expr)
            digest = hashlib.sha256(
                f"{rel}:{line}:{call}:{prompt_type}:{rendered}".encode("utf-8")
            ).hexdigest()[:12]
            records.append(
                {
                    "id": digest,
                    "scope": scope,
                    "file": rel,
                    "function": function,
                    "line": line,
                    "call": call,
                    "prompt_type": prompt_type,
                    "template": rendered,
                    "active": True,
                }
            )

    records.sort(key=lambda r: (r["file"], r["line"], r["prompt_type"]))
    return records

@router.get("")
def prompt_registry(
    scope: Literal["incident", "platform", "all"] = Query(default="all"),
) -> dict[str, Any]:
    files: list[tuple[Path, str]] = []
    if scope in {"incident", "all"}:
        files.extend((p, "incident") for p in INCIDENT_FILES)
    if scope in {"platform", "all"}:
        files.extend((p, "platform") for p in PLATFORM_FILES)

    prompts: list[dict[str, Any]] = []
    for path, prompt_scope in files:
        prompts.extend(_records_for_file(path, prompt_scope))

    return {
        "scope": scope,
        "count": len(prompts),
        "prompts": prompts,
        "note": (
            "Read-only registry generated from the active backend source at request time. "
            "F-string placeholders are shown as source templates; runtime evidence/context "
            "is not fabricated or expanded."
        ),
    }
