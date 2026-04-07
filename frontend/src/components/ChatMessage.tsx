import React, { useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChunkResult, Message } from '../types'

interface Props {
  message: Message
  onCitationClick: (chunkId: string) => void
  highlightedChunkId: string | null
}

// ── Citation helpers ──────────────────────────────────────────────────────────

function findChunkId(filename: string, chunkIndex: number, chunks: ChunkResult[]): string | null {
  return chunks.find(
    (ch) => ch.filename.toLowerCase().includes(filename.toLowerCase()) && ch.chunk_index === chunkIndex
  )?.id ?? null
}

/** Scan raw text for [filename, chunk N] patterns and return an ordered map */
function buildCitationMap(text: string, chunks: ChunkResult[]): Map<string, { num: number; chunkId: string | null }> {
  const map = new Map<string, { num: number; chunkId: string | null }>()
  const regex = /\[([^\]]+),\s*chunk\s*(\d+)\]/gi
  let counter = 1
  let match
  while ((match = regex.exec(text)) !== null) {
    const key = match[0]
    if (!map.has(key)) {
      const chunkId = findChunkId(match[1].trim(), parseInt(match[2], 10), chunks)
      map.set(key, { num: counter++, chunkId })
    }
  }
  return map
}

/** Render a text string, replacing citation patterns with superscript badges */
function renderWithCitations(
  text: string,
  citationMap: Map<string, { num: number; chunkId: string | null }>,
  onCitationClick: (id: string) => void,
  highlightedChunkId: string | null
): React.ReactNode[] {
  const regex = /(\[[^\]]+,\s*chunk\s*\d+\])/gi
  const parts = text.split(regex)
  return parts.map((part, i) => {
    const entry = citationMap.get(part) ?? citationMap.get(part.replace(/\s+/g, ' '))
    if (entry) {
      const isHighlighted = entry.chunkId === highlightedChunkId
      return (
        <span
          key={i}
          className={`citation-sup ${isHighlighted ? 'highlighted' : ''}`}
          onClick={() => entry.chunkId && onCitationClick(entry.chunkId)}
          title={part}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && entry.chunkId && onCitationClick(entry.chunkId)}
          style={{ cursor: entry.chunkId ? 'pointer' : 'default', opacity: entry.chunkId ? 1 : 0.5 }}
        >
          {entry.num}
        </span>
      )
    }
    return part
  })
}

// ── Copy helper ───────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+),\s*chunk\s*\d+\]/gi, '') // citations
    .replace(/#{1,6}\s+/g, '')                     // headings
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')       // bold/italic
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ''))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // links
    .replace(/^[\s-*>]+/gm, '')                     // list markers / blockquotes
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Sub-renderers ─────────────────────────────────────────────────────────────

function CitationProcessed({
  children,
  citationMap,
  onCitationClick,
  highlightedChunkId,
  as: Tag = 'p',
}: {
  children: React.ReactNode
  citationMap: Map<string, { num: number; chunkId: string | null }>
  onCitationClick: (id: string) => void
  highlightedChunkId: string | null
  as?: 'p' | 'li'
}) {
  function processNode(node: React.ReactNode): React.ReactNode {
    if (typeof node === 'string') {
      return renderWithCitations(node, citationMap, onCitationClick, highlightedChunkId)
    }
    if (React.isValidElement(node)) {
      const el = node as React.ReactElement<{ children?: React.ReactNode }>
      if (el.props.children) {
        return React.cloneElement(el, {
          ...el.props,
          children: React.Children.map(el.props.children, processNode),
        })
      }
    }
    if (Array.isArray(node)) return node.map(processNode)
    return node
  }
  const processed = React.Children.map(children, processNode)
  return <Tag>{processed}</Tag>
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatMessage({ message, onCitationClick, highlightedChunkId }: Props) {
  const isUser = message.role === 'user'
  const chunks = message.chunks ?? []
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hovered, setHovered] = useState(false)

  const citationMap = useMemo(
    () => buildCitationMap(message.content, chunks),
    [message.content, chunks]
  )

  const handleCopy = () => {
    const plain = stripMarkdown(message.content)
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    })
  }

  const components = useMemo(
    () => ({
      p({ children }: { children?: React.ReactNode }) {
        return (
          <CitationProcessed
            citationMap={citationMap}
            onCitationClick={onCitationClick}
            highlightedChunkId={highlightedChunkId}
            as="p"
          >
            {children}
          </CitationProcessed>
        )
      },
      li({ children }: { children?: React.ReactNode }) {
        return (
          <CitationProcessed
            citationMap={citationMap}
            onCitationClick={onCitationClick}
            highlightedChunkId={highlightedChunkId}
            as="li"
          >
            {children}
          </CitationProcessed>
        )
      },
    }),
    [citationMap, onCitationClick, highlightedChunkId]
  )

  // ── User bubble ─────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div
          style={{
            maxWidth: '72%',
            background: 'linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)',
            color: '#fff',
            borderRadius: '18px 18px 4px 18px',
            padding: '10px 16px',
            fontSize: 14,
            lineHeight: 1.6,
            boxShadow: '0 2px 16px rgba(79,123,255,0.25)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  // ── Assistant message ───────────────────────────────────────────────────────
  return (
    <div
      className="animate-fade-in"
      style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 24, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ maxWidth: '88%', width: '100%' }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: 'linear-gradient(135deg, var(--accent) 0%, #7b61ff 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            L
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Librarian</span>
        </div>

        {/* Content — no bubble, left accent line */}
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 16,
            position: 'relative',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderLeftColor = 'rgba(79,123,255,0.4)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderLeftColor = 'var(--border)' }}
        >
          <div className="prose">
            {message.streaming && !message.content ? (
              <span className="streaming-cursor" />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
                {message.content}
              </ReactMarkdown>
            )}
            {message.streaming && message.content && <span className="streaming-cursor" />}
          </div>

          {/* Streaming progress bar */}
          {message.streaming && <div className="streaming-bar" />}

          {/* Latency pills */}
          {message.latency && !message.streaming && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              <LatPill icon="⚡" label="retrieval" value={`${message.latency.retrieval_ms}ms`} />
              <LatPill icon="⏱" label="TTFT" value={`${message.latency.llm_ttft_ms}ms`} />
              <LatPill icon="🕐" label="total" value={`${message.latency.total_ms}ms`} />
              <LatPill icon="🪙" label="tokens" value={fmtN(message.latency.context_tokens)} accent />
            </div>
          )}
        </div>

        {/* Copy button — appears on hover, top-right */}
        {!message.streaming && message.content && (
          <div
            style={{
              position: 'absolute', top: 0, right: 0,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              pointerEvents: hovered ? 'auto' : 'none',
            }}
          >
            <button
              onClick={handleCopy}
              title={copied ? 'Copied!' : 'Copy answer'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 6,
                background: copied ? 'rgba(67,217,160,0.15)' : 'var(--bg-surface2)',
                border: `1px solid ${copied ? 'rgba(67,217,160,0.4)' : 'var(--border)'}`,
                color: copied ? 'var(--success)' : 'var(--text-muted)',
                fontSize: 11, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {copied ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function LatPill({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6, fontSize: 11,
      background: accent ? 'var(--accent-dim)' : 'var(--bg-surface)',
      border: `1px solid ${accent ? 'rgba(79,123,255,0.3)' : 'var(--border)'}`,
      color: accent ? 'var(--accent)' : 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <span style={{ fontSize: 10 }}>{icon}</span>
      <span style={{ color: 'var(--text-muted)', marginRight: 1 }}>{label}</span>
      <span style={{ fontWeight: 600, color: accent ? 'var(--accent)' : 'var(--text-secondary)' }}>{value}</span>
    </span>
  )
}

function fmtN(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
