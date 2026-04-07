import type { ChunkPreview, ChunkResult, DocMeta, HistoryMessage, LatencyInfo } from './types'

const BASE = '/api'

export async function fetchDocuments(): Promise<{
  documents: DocMeta[]
  total_chunks: number
  total_tokens: number
}> {
  const res = await fetch(`${BASE}/documents`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchDocumentChunks(docId: string): Promise<{
  doc_id: string
  filename: string
  chunks: ChunkPreview[]
}> {
  const res = await fetch(`${BASE}/documents/${docId}/chunks`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function uploadFiles(files: File[]): Promise<{
  ingested: DocMeta[]
  total_chunks: number
}> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function clearDocuments(): Promise<void> {
  const res = await fetch(`${BASE}/documents`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export type QueryCallbacks = {
  onRetrieval: (chunks: ChunkResult[], retrieval_ms: number) => void
  onTtft: (ttft_ms: number) => void
  onToken: (text: string) => void
  onDone: (latency: LatencyInfo) => void
  onError: (msg: string) => void
}

export async function streamQuery(
  question: string,
  k: number,
  history: HistoryMessage[],
  callbacks: QueryCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, k, history }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    callbacks.onError(text)
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Parse SSE frames
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const lines = part.split('\n')
      let event = ''
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        if (line.startsWith('data: ')) data = line.slice(6).trim()
      }
      if (!event || !data) continue

      try {
        const payload = JSON.parse(data)
        if (event === 'retrieval') {
          callbacks.onRetrieval(payload.chunks, payload.retrieval_ms)
        } else if (event === 'ttft') {
          callbacks.onTtft(payload.ttft_ms)
        } else if (event === 'token') {
          callbacks.onToken(payload.text)
        } else if (event === 'done') {
          callbacks.onDone(payload as LatencyInfo)
        } else if (event === 'error') {
          callbacks.onError(payload.message)
        }
      } catch {
        // malformed JSON — skip
      }
    }
  }
}
