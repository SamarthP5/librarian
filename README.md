# Librarian

**Document Q&A with transparent hybrid retrieval — a Pacific applied AI demo.**

Upload PDFs, text files, or Markdown. Ask questions in natural language. Get cited answers streamed in real time, with a live context inspector that shows exactly which chunks were retrieved, why they scored highly, and how many tokens were used.

---

## What this is

Librarian is a demo of the core loop inside a **context management system**:

```
Documents → Chunking → Hybrid Index → Retrieval → Context Window → LLM → Cited Answer
```

Every step is made visible:
- **Retrieved chunks** are listed in rank order with BM25, LSA cosine, and RRF fusion scores
- **Token counts** show how much of the context window was consumed
- **Latency breakdown** separates retrieval time from LLM time-to-first-token and total generation
- **Citations** in the answer link directly back to the source chunks

---

## Why this matters for Pacific

Pacific builds **enterprise context management infrastructure** (ECMS) — the layer that decides what information an AI agent can see, when, and how much. That layer is usually invisible. This demo makes it transparent.

In production (like Pacific's ECMS), this same loop would also:
- Enforce document-level permissions per user or agent
- Maintain a persistent index across sessions (not in-memory)
- Serve multiple agents simultaneously with quota-aware context budgets
- Log every retrieval decision for auditability

This is that core loop, built openly so you can see every moving part.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         LIBRARIAN                               │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │   Frontend   │    │              Backend (FastAPI)        │  │
│  │  React + TS  │    │                                       │  │
│  │  Tailwind    │    │  POST /upload                         │  │
│  │              │◄──►│    → parse PDF/TXT/MD                 │  │
│  │  3 panels:   │    │    → chunk (300 tok, 50 overlap)      │  │
│  │  · Library   │    │    → build BM25 + TF-IDF/LSA index   │  │
│  │  · Chat      │    │                                       │  │
│  │  · Inspector │    │  POST /query (SSE stream)             │  │
│  │              │    │    → BM25 retrieval (rank_bm25)       │  │
│  │  Streams SSE │    │    → Dense retrieval (TF-IDF + SVD)  │  │
│  │  Inline cite │    │    → RRF fusion (k=60)               │  │
│  │  Score badges│    │    → Claude claude-sonnet-4-20250514  │  │
│  └──────────────┘    │    → Stream tokens via SSE            │  │
│                      └──────────────────────────────────────┘  │
│                                    │                            │
│                          ┌─────────▼──────────┐               │
│                          │  In-memory store    │               │
│                          │  (no external DB)   │               │
│                          └─────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com)

### Quick start

```bash
# 1. Clone / navigate to this directory
cd Pacific

# 2. Set your API key
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Run everything
chmod +x start.sh
./start.sh
```

Open **http://localhost:5173** in your browser.

### Manual start (if you prefer)

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

API docs available at **http://localhost:8000/docs**.

---

## Key design decisions

### Chunking with overlap
Chunks are 300 tokens with 50-token overlap. Without overlap, a sentence that straddles a chunk boundary would appear truncated in both adjacent chunks — the LLM sees half a thought. Overlap ensures every sentence appears fully in at least one chunk.

### BM25 + LSA hybrid retrieval
BM25 (via `rank_bm25`) is fast and interpretable — it rewards exact keyword matches. TF-IDF + Truncated SVD ("LSA") maps chunks into a 64-dimensional semantic space, capturing synonymy and latent topics that BM25 misses. Neither alone is sufficient: BM25 fails on paraphrases; dense retrieval fails on rare terms.

### Reciprocal Rank Fusion (RRF) over weighted sum
BM25 scores and cosine similarities live on completely different numeric scales. Normalizing them with weights (`α·bm25 + β·dense`) requires careful per-corpus tuning. RRF ignores raw scores entirely and fuses only rank order:

```
rrf(d) = 1/(60 + rank_bm25(d)) + 1/(60 + rank_dense(d))
```

The constant `k=60` is from Cormack et al. (2009). This makes fusion robust to score distribution changes as the corpus grows.

### Streaming (SSE)
Time-to-first-token (TTFT) matters more than total latency for perceived responsiveness. Users start reading immediately while the model generates the rest. The API emits a `retrieval` event before even calling the LLM, so the context inspector populates instantly.

### Token count transparency
The context window is a scarce resource. Showing how many tokens were consumed in every answer builds user trust and helps users understand the relationship between corpus size, query specificity, and answer quality.

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/documents` | List indexed documents |
| POST | `/upload` | Upload files (multipart/form-data) |
| DELETE | `/documents` | Clear all documents |
| POST | `/query` | Ask a question (SSE stream) |

### SSE event types from `/query`

| Event | Payload | Description |
|-------|---------|-------------|
| `retrieval` | `{chunks, retrieval_ms}` | Retrieved chunks + retrieval latency |
| `ttft` | `{ttft_ms}` | Time to first LLM token |
| `token` | `{text}` | Next streamed token |
| `done` | `{retrieval_ms, llm_ttft_ms, llm_total_ms, total_ms, context_tokens, output_tokens}` | Final latency breakdown |
| `error` | `{message}` | Error occurred |
