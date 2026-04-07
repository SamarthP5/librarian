export interface DocMeta {
  id: string
  filename: string
  chunk_count: number
  total_tokens: number
}

export interface ChunkResult {
  id: string
  doc_id: string
  filename: string
  page: number | null
  chunk_index: number
  text: string
  tokens: number
  bm25_score: number
  bm25_rank: number
  dense_score: number
  dense_rank: number
  rrf_score: number
  top_bm25_terms: string[]
}

export interface LatencyInfo {
  retrieval_ms: number
  llm_ttft_ms: number
  llm_total_ms: number
  total_ms: number
  context_tokens: number
  output_tokens: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  chunks?: ChunkResult[]
  latency?: LatencyInfo
}

/** Slim chunk shape returned by GET /documents/{id}/chunks */
export interface ChunkPreview {
  id: string
  chunk_index: number
  page: number | null
  text: string
  tokens: number
}

/** History entry sent to backend for multi-turn context */
export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Toast {
  id: string
  message: string
  exiting: boolean
}
