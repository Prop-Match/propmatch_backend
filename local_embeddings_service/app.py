"""Local multilingual embedding and Chroma service for PropMatch."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import chromadb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("propmatch.local_embeddings")

MODEL_NAME = os.getenv(
    "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
CHROMA_PATH = Path(os.getenv("CHROMA_PATH", "./chroma_data"))
COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "propmatch_documents_local_v1")

app = FastAPI(title="PropMatch Local Embeddings")


class EmbedRequest(BaseModel):
    text: str = Field(min_length=1)


class UpsertRequest(BaseModel):
    id: str
    document: str = Field(min_length=1)
    embedding: list[float] = Field(min_length=1)
    metadata: dict[str, str | int | float | bool]


class QueryRequest(BaseModel):
    embedding: list[float] = Field(min_length=1)
    n_results: int = Field(default=10, ge=1, le=100)


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    logger.info("Loading embedding model %s on CPU", MODEL_NAME)
    return SentenceTransformer(MODEL_NAME, device="cpu")


@lru_cache(maxsize=1)
def get_collection() -> Any:
    CHROMA_PATH.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_PATH))
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine", "embedding_model": MODEL_NAME},
        embedding_function=None,
    )


def encode(texts: list[str]) -> list[list[float]]:
    try:
        vectors = get_model().encode(
            texts,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return [vector.astype(float).tolist() for vector in vectors]
    except Exception as error:  # pragma: no cover - external model failures
        logger.exception("Local embedding generation failed")
        raise HTTPException(status_code=503, detail="Local embedding generation failed") from error


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME, "collection": COLLECTION_NAME}


@app.post("/embed")
def embed(request: EmbedRequest) -> dict[str, Any]:
    embedding = encode([request.text])[0]
    return {"embedding": embedding, "dimension": len(embedding), "model": MODEL_NAME}


@app.post("/upsert")
def upsert(request: UpsertRequest) -> dict[str, str]:
    try:
        get_collection().upsert(
            ids=[request.id],
            documents=[request.document],
            embeddings=[request.embedding],
            metadatas=[request.metadata],
        )
        return {"status": "upserted", "collection": COLLECTION_NAME}
    except Exception as error:  # pragma: no cover - Chroma failures
        logger.exception("Chroma upsert failed")
        raise HTTPException(status_code=503, detail="Local Chroma upsert failed") from error


@app.post("/query")
def query(request: QueryRequest) -> dict[str, Any]:
    try:
        return get_collection().query(
            query_embeddings=[request.embedding],
            n_results=request.n_results,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as error:  # pragma: no cover - Chroma failures
        logger.exception("Chroma query failed")
        raise HTTPException(status_code=503, detail="Local Chroma query failed") from error
