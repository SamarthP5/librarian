"""
Librarian — backend API
Pacific applied AI demo: transparent hybrid retrieval + LLM Q&A

Design decisions are commented inline throughout.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import tiktoken
from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from rank_bm25 import BM25Okapi
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("librarian")

# ---------------------------------------------------------------------------
# Token counting
# ---------------------------------------------------------------------------
# We use cl100k_base (the tokenizer shared by gpt-4/claude-3 family) as a
# close approximation for token counting. Exact counts vary by model but this
# is accurate enough to surface context-window pressure to users.
_tokenizer = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(_tokenizer.encode(text))


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class Chunk:
    __slots__ = ("id", "doc_id", "filename", "page", "chunk_index", "text", "tokens")

    def __init__(
        self,
        doc_id: str,
        filename: str,
        page: int | None,
        chunk_index: int,
        text: str,
    ) -> None:
        self.id = str(uuid.uuid4())
        self.doc_id = doc_id
        self.filename = filename
        self.page = page
        self.chunk_index = chunk_index
        self.text = text
        self.tokens = count_tokens(text)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "doc_id": self.doc_id,
            "filename": self.filename,
            "page": self.page,
            "chunk_index": self.chunk_index,
            "text": self.text,
            "tokens": self.tokens,
        }


class Document:
    def __init__(self, filename: str) -> None:
        self.id = str(uuid.uuid4())
        self.filename = filename
        self.chunks: list[Chunk] = []

    @property
    def chunk_count(self) -> int:
        return len(self.chunks)

    @property
    def total_tokens(self) -> int:
        return sum(c.tokens for c in self.chunks)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "chunk_count": self.chunk_count,
            "total_tokens": self.total_tokens,
        }


# ---------------------------------------------------------------------------
# In-memory store + index (no external DB)
# ---------------------------------------------------------------------------

class DocumentStore:
    def __init__(self) -> None:
        self._docs: dict[str, Document] = {}
        self._chunks: list[Chunk] = []

        # BM25 index over tokenized chunk texts
        self._bm25: BM25Okapi | None = None
        # TF-IDF + LSA dense index
        self._tfidf: TfidfVectorizer | None = None
        self._svd: TruncatedSVD | None = None
        self._dense_matrix: np.ndarray | None = None  # shape (n_chunks, n_components)

    # -----------------------------------------------------------------------
    # Chunking
    # -----------------------------------------------------------------------

    def _chunk_text(
        self, text: str, filename: str, doc_id: str, page: int | None = None
    ) -> list[Chunk]:
        """
        Sliding-window chunking: target ~300 tokens per chunk with 50-token overlap.

        Why overlap? A sentence or phrase may straddle a chunk boundary. Without
        overlap that context is split — the model sees only half. Overlap ensures
        every sentence appears fully in at least one chunk.

        We split on sentences first (double-newline or ". ") to avoid cutting mid-
        sentence, then pack words greedily until we hit the token budget.
        """
        TARGET_TOKENS = 300
        OVERLAP_TOKENS = 50

        # Split on paragraph boundaries first, then sentence boundaries
        import re
        sentences = re.split(r"(?<=[.!?])\s+|\n{2,}", text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks: list[Chunk] = []
        current_words: list[str] = []
        chunk_index = 0

        def flush(words: list[str]) -> None:
            nonlocal chunk_index
            if not words:
                return
            chunk_text = " ".join(words)
            chunks.append(Chunk(doc_id, filename, page, chunk_index, chunk_text))
            chunk_index += 1

        for sentence in sentences:
            words = sentence.split()
            # Check if adding this sentence would overflow the target
            candidate = current_words + words
            if count_tokens(" ".join(candidate)) > TARGET_TOKENS and current_words:
                flush(current_words)
                # Carry overlap: keep the last OVERLAP_TOKENS worth of words
                overlap_words: list[str] = []
                for w in reversed(current_words):
                    if count_tokens(" ".join([w] + overlap_words)) <= OVERLAP_TOKENS:
                        overlap_words.insert(0, w)
                    else:
                        break
                current_words = overlap_words + words
            else:
                current_words = candidate

        flush(current_words)
        return chunks

    # -----------------------------------------------------------------------
    # Indexing
    # -----------------------------------------------------------------------

    def _rebuild_index(self) -> None:
        """
        Rebuild BM25 and LSA dense indexes after any document change.

        BM25: exact term match with TF-IDF-like normalization. Fast, interpretable,
        great for keyword queries.

        Dense (TF-IDF + LSA): maps chunks into a 64-dimensional semantic space via
        SVD. Captures synonymy and latent topics that BM25 misses.

        We fuse both with RRF instead of a weighted sum because BM25 scores and
        cosine similarities live on incompatible scales — normalizing them heuristi-
        cally is fragile. RRF only cares about rank order, making fusion robust to
        score distribution changes as the corpus grows.
        """
        if not self._chunks:
            self._bm25 = None
            self._tfidf = None
            self._svd = None
            self._dense_matrix = None
            return

        tokenized = [c.text.lower().split() for c in self._chunks]
        self._bm25 = BM25Okapi(tokenized)

        self._tfidf = TfidfVectorizer(
            sublinear_tf=True, max_features=20_000, ngram_range=(1, 2)
        )
        tfidf_matrix = self._tfidf.fit_transform([c.text for c in self._chunks])

        n_components = min(64, tfidf_matrix.shape[1] - 1, len(self._chunks) - 1)
        if n_components < 1:
            # Corpus too small for SVD — fall back to raw TF-IDF
            self._svd = None
            self._dense_matrix = tfidf_matrix.toarray()
        else:
            self._svd = TruncatedSVD(n_components=n_components, random_state=42)
            self._dense_matrix = self._svd.fit_transform(tfidf_matrix)

        logger.info(
            "Index rebuilt: %d chunks, %d SVD dims",
            len(self._chunks),
            self._dense_matrix.shape[1] if self._dense_matrix is not None else 0,
        )

    # -----------------------------------------------------------------------
    # Document ingestion
    # -----------------------------------------------------------------------

    def add_document(self, filename: str, chunks: list[Chunk]) -> Document:
        doc = Document(filename)
        doc.chunks = chunks
        for chunk in chunks:
            chunk.doc_id = doc.id
        self._docs[doc.id] = doc
        self._chunks.extend(chunks)
        self._rebuild_index()
        return doc

    def clear(self) -> None:
        self._docs.clear()
        self._chunks.clear()
        self._bm25 = None
        self._tfidf = None
        self._svd = None
        self._dense_matrix = None

    # -----------------------------------------------------------------------
    # Retrieval
    # -----------------------------------------------------------------------

    def retrieve(self, query: str, k: int = 5) -> list[dict[str, Any]]:
        """
        Hybrid retrieval: BM25 + dense cosine, fused with Reciprocal Rank Fusion.

        RRF formula: score(d) = Σ 1 / (k_rrf + rank_i(d))
        where k_rrf=60 is the smoothing constant recommended in the original paper
        (Cormack et al., 2009). It prevents top-ranked documents from dominating.
        """
        if not self._chunks or self._bm25 is None:
            return []

        n = len(self._chunks)

        # --- BM25 ---
        bm25_scores = self._bm25.get_scores(query.lower().split())
        bm25_ranks = np.argsort(-bm25_scores).argsort()  # rank 0 = best

        # --- Dense (TF-IDF + LSA cosine) ---
        query_tfidf = self._tfidf.transform([query])
        if self._svd is not None:
            query_dense = self._svd.transform(query_tfidf)
        else:
            query_dense = query_tfidf.toarray()

        dense_sims = cosine_similarity(query_dense, self._dense_matrix)[0]
        dense_ranks = np.argsort(-dense_sims).argsort()

        # --- RRF fusion ---
        K_RRF = 60
        rrf_scores = 1.0 / (K_RRF + bm25_ranks) + 1.0 / (K_RRF + dense_ranks)
        top_indices = np.argsort(-rrf_scores)[:k]

        results = []
        for idx in top_indices:
            chunk = self._chunks[idx]
            results.append(
                {
                    **chunk.to_dict(),
                    "bm25_score": float(bm25_scores[idx]),
                    "bm25_rank": int(bm25_ranks[idx]),
                    "dense_score": float(dense_sims[idx]),
                    "dense_rank": int(dense_ranks[idx]),
                    "rrf_score": float(rrf_scores[idx]),
                    # Top BM25 terms for "Why this chunk?" tooltip
                    "top_bm25_terms": self._top_bm25_terms(query, chunk.text),
                }
            )

        return results

    def _top_bm25_terms(self, query: str, chunk_text: str, n: int = 5) -> list[str]:
        """Return query terms (minus stopwords) that appear in the chunk."""
        _STOP = {
            "a", "an", "the", "is", "it", "in", "on", "at", "to", "of",
            "and", "or", "but", "for", "with", "this", "that", "are", "be",
            "as", "by", "from", "not", "was", "were", "has", "have", "had",
            "its", "what", "how", "why", "which", "who", "can", "will",
        }
        query_terms = [
            t for t in query.lower().split()
            if t not in _STOP and len(t) > 2
        ]
        chunk_lower = chunk_text.lower()
        matched = [t for t in query_terms if t in chunk_lower]
        return matched[:n]

    # -----------------------------------------------------------------------
    # Accessors
    # -----------------------------------------------------------------------

    @property
    def documents(self) -> list[Document]:
        return list(self._docs.values())

    @property
    def chunks(self) -> list[Chunk]:
        return self._chunks

    @property
    def total_tokens(self) -> int:
        return sum(c.tokens for c in self._chunks)


# Singleton store
store = DocumentStore()


# ---------------------------------------------------------------------------
# File parsing helpers
# ---------------------------------------------------------------------------

def parse_txt(content: bytes) -> list[tuple[str, int | None]]:
    """Returns list of (text, page) — TXT has no pages."""
    return [(content.decode("utf-8", errors="replace"), None)]


def parse_md(content: bytes) -> list[tuple[str, int | None]]:
    return [(content.decode("utf-8", errors="replace"), None)]


def parse_pdf(content: bytes) -> list[tuple[str, int]]:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(content))
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            pages.append((text, i))
    return pages


def parse_file(filename: str, content: bytes) -> list[tuple[str, int | None]]:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return parse_pdf(content)
    elif ext in (".md", ".markdown"):
        return parse_md(content)
    else:
        return parse_txt(content)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class HistoryMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class QueryRequest(BaseModel):
    question: str
    k: int = 5
    history: list[HistoryMessage] = []


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Librarian API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_client = AsyncAnthropic()

MODEL = "claude-sonnet-4-20250514"

SYSTEM_PROMPT = """You are Librarian, a precise research assistant.

Answer the user's question using ONLY the context chunks provided below. Do not use outside knowledge.

Rules:
- Cite every factual claim with [Filename, chunk N] immediately after the claim.
- If multiple chunks support a claim, cite all of them: [Doc A, chunk 1][Doc B, chunk 3].
- If the context does not contain enough information to answer, say so clearly.
- Be concise but complete. Use markdown for structure when helpful.
- Never fabricate information not present in the context.
"""


def build_context_prompt(chunks: list[dict[str, Any]]) -> str:
    parts = ["## Context Chunks\n"]
    for chunk in chunks:
        parts.append(
            f"[{chunk['filename']}, chunk {chunk['chunk_index']}]\n{chunk['text']}\n"
        )
    return "\n".join(parts)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL}


@app.get("/documents")
async def list_documents() -> dict[str, Any]:
    return {
        "documents": [d.to_dict() for d in store.documents],
        "total_chunks": len(store.chunks),
        "total_tokens": store.total_tokens,
    }


@app.get("/documents/{doc_id}/chunks")
async def get_document_chunks(doc_id: str) -> dict[str, Any]:
    if doc_id not in store._docs:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = store._docs[doc_id]
    return {
        "doc_id": doc_id,
        "filename": doc.filename,
        "chunks": [c.to_dict() for c in doc.chunks],
    }


@app.delete("/documents")
async def clear_documents() -> dict[str, str]:
    store.clear()
    return {"status": "cleared"}


@app.post("/upload")
async def upload_documents(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    ingested = []
    for file in files:
        filename = file.filename or "unknown"
        ext = Path(filename).suffix.lower()
        if ext not in (".pdf", ".txt", ".md", ".markdown"):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {ext}. Use PDF, TXT, or MD.",
            )

        content = await file.read()
        pages = parse_file(filename, content)

        all_chunks: list[Chunk] = []
        temp_doc_id = str(uuid.uuid4())
        for text, page in pages:
            chunks = store._chunk_text(text, filename, temp_doc_id, page)
            all_chunks.extend(chunks)

        doc = store.add_document(filename, all_chunks)
        ingested.append(
            {
                "id": doc.id,
                "filename": doc.filename,
                "chunk_count": doc.chunk_count,
                "total_tokens": doc.total_tokens,
            }
        )

    return {"ingested": ingested, "total_chunks": len(store.chunks)}


@app.post("/query")
async def query_documents(req: QueryRequest) -> StreamingResponse:
    if not store.chunks:
        raise HTTPException(status_code=400, detail="No documents indexed yet.")

    async def event_stream() -> Any:
        # --- Retrieval ---
        t0 = time.monotonic()
        chunks = store.retrieve(req.question, k=req.k)
        retrieval_ms = int((time.monotonic() - t0) * 1000)

        if not chunks:
            yield _sse("error", {"message": "No relevant chunks found."})
            return

        # Emit retrieval results immediately so the UI can show the context
        # inspector while the LLM is still generating.
        yield _sse(
            "retrieval",
            {
                "chunks": chunks,
                "retrieval_ms": retrieval_ms,
            },
        )

        # --- LLM call ---
        context_prompt = build_context_prompt(chunks)
        context_tokens = count_tokens(context_prompt) + count_tokens(req.question)

        # Current turn: prepend retrieved context to the question so the model
        # always grounds its answer in the freshly-retrieved chunks.
        current_user_message = f"{context_prompt}\n\n## Question\n{req.question}"

        # Build the messages list for multi-turn: prepend prior history, then
        # attach the current question with its retrieved context.
        # History messages are plain (no context injected) — the model references
        # prior turns for conversational continuity, not for retrieval.
        messages: list[dict[str, str]] = [
            {"role": h.role, "content": h.content}
            for h in req.history
            if h.content.strip()
        ]
        messages.append({"role": "user", "content": current_user_message})

        # Why streaming? Time-to-first-token (TTFT) dominates perceived latency.
        # Users start reading before the full answer arrives, making the system
        # feel fast even when total generation time is long.
        t1 = time.monotonic()
        ttft_ms: int | None = None
        total_output_tokens = 0
        answer_text = ""

        try:
            async with anthropic_client.messages.stream(
                model=MODEL,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    if ttft_ms is None:
                        ttft_ms = int((time.monotonic() - t1) * 1000)
                        yield _sse("ttft", {"ttft_ms": ttft_ms})
                    answer_text += text
                    total_output_tokens += count_tokens(text)
                    yield _sse("token", {"text": text})

        except Exception as e:
            logger.exception("LLM error")
            yield _sse("error", {"message": str(e)})
            return

        total_ms = int((time.monotonic() - t0) * 1000)

        yield _sse(
            "done",
            {
                "retrieval_ms": retrieval_ms,
                "llm_ttft_ms": ttft_ms or 0,
                "llm_total_ms": total_ms - retrieval_ms,
                "total_ms": total_ms,
                "context_tokens": context_tokens,
                "output_tokens": total_output_tokens,
            },
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
