from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path
from typing import Any

from .core import client

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSIONS = int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))


def _documents() -> list[dict[str, str]]:
    documents = []
    for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        title = lines[0].removeprefix("# ").strip() if lines else path.stem
        doc_type = "DOCUMENT"
        if len(lines) > 1 and lines[1].startswith("Type:"):
            doc_type = lines[1].split(":", 1)[1].strip().upper()
        documents.append({"id": path.stem, "title": title, "type": doc_type, "content": text})
    return documents


def _embed(texts: list[str]) -> list[list[float]]:
    response = client().embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    return [item.embedding for item in response.data]


def _cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def _memory_search(query: str, documents: list[dict[str, str]]) -> list[dict[str, Any]]:
    vectors = _embed([query, *[doc["content"] for doc in documents]])
    query_vector, doc_vectors = vectors[0], vectors[1:]
    ranked = sorted(
        [dict(doc, score=max(0.0, _cosine(query_vector, vector))) for doc, vector in zip(documents, doc_vectors)],
        key=lambda item: item["score"],
        reverse=True,
    )
    return ranked[:4]


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def _pgvector_search(query: str, documents: list[dict[str, str]]) -> list[dict[str, Any]]:
    import psycopg

    database_url = os.environ["DATABASE_URL"]
    with psycopg.connect(database_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cursor.execute(
                f"""CREATE TABLE IF NOT EXISTS incident_knowledge (
                    id text PRIMARY KEY,
                    title text NOT NULL,
                    doc_type text NOT NULL,
                    content text NOT NULL,
                    content_hash text NOT NULL,
                    embedding vector({EMBEDDING_DIMENSIONS}) NOT NULL
                )"""
            )
            cursor.execute("SELECT id, content_hash FROM incident_knowledge")
            existing = dict(cursor.fetchall())
            changed = []
            for doc in documents:
                digest = hashlib.sha256(doc["content"].encode("utf-8")).hexdigest()
                if existing.get(doc["id"]) != digest:
                    changed.append((doc, digest))
            if changed:
                embeddings = _embed([doc["content"] for doc, _ in changed])
                for (doc, digest), embedding in zip(changed, embeddings):
                    cursor.execute(
                        """INSERT INTO incident_knowledge (id, title, doc_type, content, content_hash, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s::vector)
                        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, doc_type=EXCLUDED.doc_type,
                        content=EXCLUDED.content, content_hash=EXCLUDED.content_hash, embedding=EXCLUDED.embedding""",
                        (doc["id"], doc["title"], doc["type"], doc["content"], digest, _vector_literal(embedding)),
                    )
            query_embedding = _embed([query])[0]
            cursor.execute(
                """SELECT id, title, doc_type, content, 1 - (embedding <=> %s::vector) AS score
                FROM incident_knowledge ORDER BY embedding <=> %s::vector LIMIT 4""",
                (_vector_literal(query_embedding), _vector_literal(query_embedding)),
            )
            return [
                {"id": row[0], "title": row[1], "type": row[2], "content": row[3], "score": max(0.0, float(row[4]))}
                for row in cursor.fetchall()
            ]


def retrieve(query: str) -> tuple[list[dict[str, Any]], str, str | None]:
    documents = _documents()
    if not documents:
        raise RuntimeError("No knowledge documents are available")
    if os.getenv("DATABASE_URL"):
        try:
            return _pgvector_search(query, documents), "Neon PostgreSQL + pgvector", None
        except Exception as exc:
            evidence = _memory_search(query, documents)
            return evidence, "OpenAI embeddings · in-memory fallback", f"pgvector fallback: {type(exc).__name__}"
    return _memory_search(query, documents), "OpenAI embeddings · in-memory vectors", None
