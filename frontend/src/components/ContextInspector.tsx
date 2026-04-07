import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChunkResult } from '../types'

interface Props {
  chunks: ChunkResult[]
  highlightedChunkId: string | null
  contextTokens: number
}

// Rank → left-border color
const RANK_COLORS = ['#4f7bff', '#7b61ff', '#a855f7', '#a855f7', '#a855f7']
const rankColor = (rank: number) => RANK_COLORS[Math.min(rank - 1, RANK_COLORS.length - 1)]

// ── Search highlight helper ───────────────────────────────────────────────────

function highlightText(text: string, query: string): React.ReactElement {
  if (!query.trim()) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="search-highlight">{part}</mark>
          : part
      )}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContextInspector({ chunks, highlightedChunkId, contextTokens }: Props) {
  const [search, setSearch] = useState('')
  const chunkRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return chunks
    return chunks.filter((c) => c.text.toLowerCase().includes(q))
  }, [chunks, search])

  // Scroll highlighted chunk into view
  useEffect(() => {
    if (!highlightedChunkId) return
    const el = chunkRefs.current.get(highlightedChunkId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedChunkId])

  // Reset search when chunks change (new query)
  useEffect(() => {
    setSearch('')
  }, [chunks])

  const maxRrf = chunks.length > 0 ? Math.max(...chunks.map((c) => c.rrf_score)) : 1

  if (chunks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', padding: 24, textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, opacity: 0.6 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Retrieved context appears here after each answer
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: 48, borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Context Window</span>
        </div>
        {/* Token chip with glow — surfaced because context window is a scarce resource */}
        <TokenChip tokens={contextTokens} />
      </div>

      {/* Search bar */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter chunks…"
            style={{
              width: '100%', padding: '6px 30px 6px 30px', borderRadius: 8,
              background: 'var(--bg-base)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontSize: 12, outline: 'none',
              transition: 'border-color 0.2s',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(79,123,255,0.5)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                color: 'var(--text-muted)', lineHeight: 1,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        {search && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, textAlign: 'center' }}>
            {filtered.length} of {chunks.length} chunks
          </p>
        )}
      </div>

      {/* Chunk cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {filtered.length === 0 && search && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 20 }}>
            No chunks match "{search}"
          </p>
        )}
        {filtered.map((chunk, i) => {
          const globalRank = chunks.indexOf(chunk) + 1
          return (
            <ChunkCard
              key={chunk.id}
              chunk={chunk}
              rank={globalRank}
              maxRrf={maxRrf}
              highlighted={chunk.id === highlightedChunkId}
              delayClass={`chunk-delay-${Math.min(i, 4)}`}
              searchQuery={search}
              ref={(el) => {
                if (el) chunkRefs.current.set(chunk.id, el)
                else chunkRefs.current.delete(chunk.id)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Token chip ────────────────────────────────────────────────────────────────

function TokenChip({ tokens }: { tokens: number }) {
  const pct = Math.min(100, (tokens / 200000) * 100)
  const color = pct > 80 ? 'var(--error)' : pct > 50 ? 'var(--warning)' : 'var(--success)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 48, height: 3, borderRadius: 2, background: 'var(--bg-base)', overflow: 'hidden' }}>
        <div
          className="relevance-bar-fill"
          style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: color }}
        />
      </div>
      <span style={{
        fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)',
        padding: '2px 7px', borderRadius: 5,
        background: 'var(--accent-dim)', border: '1px solid rgba(79,123,255,0.25)',
        boxShadow: '0 0 8px var(--accent-glow)',
      }}>
        {fmtN(tokens)}t
      </span>
    </div>
  )
}

// ── Chunk card ────────────────────────────────────────────────────────────────

interface ChunkCardProps {
  chunk: ChunkResult
  rank: number
  maxRrf: number
  highlighted: boolean
  delayClass: string
  searchQuery: string
}

import React from 'react'

const ChunkCard = React.forwardRef<HTMLDivElement, ChunkCardProps>(
  ({ chunk, rank, maxRrf, highlighted, delayClass, searchQuery }, ref) => {
    const [expanded, setExpanded] = useState(false)
    const [tooltipVisible, setTooltipVisible] = useState(false)
    const relevancePct = maxRrf > 0 ? (chunk.rrf_score / maxRrf) * 100 : 0
    const borderColor = rankColor(rank)

    return (
      <div
        ref={ref}
        className={`animate-slide-in-up ${delayClass}`}
        style={{
          borderRadius: 10, overflow: 'hidden',
          border: `1px solid ${highlighted ? 'rgba(79,123,255,0.5)' : 'var(--border)'}`,
          borderLeft: `3px solid ${highlighted ? 'var(--accent)' : borderColor}`,
          background: highlighted ? 'rgba(79,123,255,0.06)' : 'var(--bg-base)',
          boxShadow: highlighted ? '0 0 16px rgba(79,123,255,0.12)' : 'none',
          transition: 'all 0.2s',
        }}
      >
        {/* Relevance bar at bottom of card */}
        <div style={{ padding: '10px 12px 4px' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              {/* Rank badge */}
              <div style={{
                width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: highlighted ? 'var(--accent)' : 'var(--bg-surface2)',
                color: highlighted ? '#fff' : borderColor,
                fontSize: 10, fontWeight: 700,
                border: `1px solid ${highlighted ? 'transparent' : 'var(--border)'}`,
              }}>
                {rank}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={chunk.filename}>
                  {chunk.filename}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '1px 0 0' }}>
                  chunk {chunk.chunk_index}
                  {chunk.page ? ` · p.${chunk.page}` : ''}
                  {' · '}{chunk.tokens} tok
                </p>
              </div>
            </div>

            {/* Score badges */}
            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              <ScoreBadge label="BM25" value={chunk.bm25_score} color="#6b9fd4" />
              <ScoreBadge label="LSA" value={chunk.dense_score} color="#6ecf8a" />
              <div style={{ position: 'relative' }}>
                <ScoreBadge
                  label="RRF"
                  value={chunk.rrf_score}
                  color="var(--accent)"
                  onClick={() => setTooltipVisible((v) => !v)}
                  clickable
                />
                {tooltipVisible && (
                  <div
                    className="animate-fade-in"
                    style={{
                      position: 'absolute', right: 0, top: 32, zIndex: 20,
                      width: 168, borderRadius: 10, padding: 12,
                      background: 'var(--bg-surface2)', border: '1px solid var(--border)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>
                      Why this chunk?
                    </p>
                    {chunk.top_bm25_terms.length > 0 ? (
                      <>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>Matching BM25 terms:</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {chunk.top_bm25_terms.map((t) => (
                            <span key={t} style={{
                              padding: '2px 6px', borderRadius: 4, fontSize: 10,
                              background: 'var(--accent-dim)', color: 'var(--accent)',
                              border: '1px solid rgba(79,123,255,0.25)',
                            }}>{t}</span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Ranked by semantic similarity (LSA)</p>
                    )}
                    <button
                      onClick={() => setTooltipVisible(false)}
                      style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: '100%', textAlign: 'right' }}
                    >
                      close
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chunk text */}
          <p style={{
            fontSize: 11, lineHeight: 1.65,
            color: 'var(--text-secondary)', margin: 0,
            display: '-webkit-box', WebkitBoxOrient: 'vertical',
            WebkitLineClamp: expanded ? 'unset' : 3,
            overflow: 'hidden',
          } as React.CSSProperties}>
            {highlightText(chunk.text, searchQuery)}
          </p>
          {chunk.text.length > 180 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0 0', marginTop: 2 }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>

        {/* Relevance bar */}
        <div style={{ padding: '4px 12px 8px' }}>
          <div style={{ height: 2, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            <div
              className="relevance-bar-fill"
              style={{
                height: '100%', borderRadius: 2,
                width: `${relevancePct}%`,
                background: `linear-gradient(90deg, ${borderColor}, ${highlighted ? 'var(--accent)' : borderColor})`,
              }}
            />
          </div>
        </div>
      </div>
    )
  }
)
ChunkCard.displayName = 'ChunkCard'

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({
  label,
  value,
  color,
  onClick,
  clickable,
}: {
  label: string
  value: number
  color: string
  onClick?: () => void
  clickable?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={`${label}: ${value.toFixed(4)}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '2px 5px', borderRadius: 5, minWidth: 34,
        background: 'var(--bg-surface2)', border: '1px solid var(--border)',
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'border-color 0.15s' : 'none',
      }}
      onMouseEnter={(e) => { if (clickable) e.currentTarget.style.borderColor = 'var(--accent)' }}
      onMouseLeave={(e) => { if (clickable) e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: '0.6rem', fontWeight: 700, color, lineHeight: 1.4 }}>
        {Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(3)}
      </span>
      <span style={{ fontSize: '0.52rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{label}</span>
    </button>
  )
}

function fmtN(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
