"""Embedding provider (PRD 12.2).

The default provider is a local hashed bag-of-terms projection: deterministic, needs no
network, and produces a stable 1024-dimension vector whose cosine similarity behaves the
way the matching formula expects. It keeps semantic matching working in tests, on a
laptop and during a demo with no connectivity.

Swapping in a multilingual sentence embedding model is a configuration change: the
interface, the stored dimension and the cosine computation stay the same. In a
PostgreSQL deployment the same vectors live in a pgvector column with an HNSW index.
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.core.hash import sha256_text
from app.core.logging import get_logger
from app.domain.matching import tokenise

log = get_logger(__name__)

BIGRAM_WEIGHT = 0.6


@dataclass
class EmbeddingResult:
    vector: list[float]
    model: str
    dimensions: int
    content_hash: str


class EmbeddingProvider:
    name = "provider"

    async def embed(self, text: str) -> EmbeddingResult:
        raise NotImplementedError


class LocalHashingProvider(EmbeddingProvider):
    """Hashing trick with sub-token character n-grams, then L2 normalisation.

    Character n-grams give partial credit for morphological variants and for Hindi and
    English text mixed in the same field, without shipping a vocabulary file.
    """

    name = "local_hashing"

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions

    def _index(self, token: str) -> tuple[int, float]:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        position = int.from_bytes(digest[:4], "big") % self.dimensions
        sign = 1.0 if digest[4] & 1 else -1.0
        return position, sign

    def _char_ngrams(self, token: str, n: int = 4) -> list[str]:
        padded = "<" + token + ">"
        if len(padded) <= n:
            return [padded]
        return [padded[i : i + n] for i in range(len(padded) - n + 1)]

    async def embed(self, text: str) -> EmbeddingResult:
        vector = [0.0] * self.dimensions
        tokens = tokenise(text)

        for token in tokens:
            position, sign = self._index(token)
            vector[position] += sign * 1.0
            for gram in self._char_ngrams(token):
                gram_position, gram_sign = self._index(gram)
                vector[gram_position] += gram_sign * 0.25

        for first, second in zip(tokens, tokens[1:], strict=False):
            position, sign = self._index(first + "_" + second)
            vector[position] += sign * BIGRAM_WEIGHT

        norm = math.sqrt(sum(value * value for value in vector))
        if norm > 0:
            vector = [round(value / norm, 6) for value in vector]

        return EmbeddingResult(
            vector=vector,
            model=settings.embedding_model,
            dimensions=self.dimensions,
            content_hash=sha256_text(_normalise(text)),
        )


class OpenAiCompatibleEmbeddingProvider(EmbeddingProvider):
    name = "openai_compatible"

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions

    async def embed(self, text: str) -> EmbeddingResult:
        import httpx

        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                str(settings.llm_base_url).rstrip("/") + "/embeddings",
                headers={"Authorization": "Bearer " + str(settings.llm_api_key)},
                json={"model": settings.embedding_model, "input": text[:8000]},
            )
            response.raise_for_status()
            data = response.json()
        vector = [float(x) for x in data["data"][0]["embedding"]]
        return EmbeddingResult(
            vector=vector,
            model=settings.embedding_model,
            dimensions=len(vector),
            content_hash=sha256_text(_normalise(text)),
        )


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


_provider: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        if settings.embedding_provider == "local_hashing":
            _provider = LocalHashingProvider(settings.embedding_dimensions)
        else:
            _provider = OpenAiCompatibleEmbeddingProvider(settings.embedding_dimensions)
    return _provider


async def embed_text(text: str) -> EmbeddingResult:
    provider = get_embedding_provider()
    try:
        return await provider.embed(text)
    except Exception as exc:
        # Matching falls back to keyword and sector ranking (PRD 10.6).
        log.warning("Embedding failed, falling back to keyword ranking", error=str(exc))
        return EmbeddingResult(
            vector=[], model=settings.embedding_model, dimensions=0, content_hash=sha256_text(_normalise(text))
        )


def content_hash_of(text: str) -> str:
    return sha256_text(_normalise(text))


def provider_health() -> dict[str, Any]:
    return {
        "provider": settings.embedding_provider,
        "model": settings.embedding_model,
        "dimensions": settings.embedding_dimensions,
    }
