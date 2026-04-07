import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChunkPreview, DocMeta } from '../types'
import { clearDocuments, fetchDocumentChunks, uploadFiles } from '../api'

interface Props {
  docs: DocMeta[]
  totalChunks: number
  totalTokens: number
  onDocsChange: () => void
}

// ── Main component ────────────────────────────────────────────────────────────

export function DocumentLibrary({ docs, totalChunks, totalTokens, onDocsChange }: Props) {
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase()
        return ext === 'pdf' || ext === 'txt' || ext === 'md'
      })
      if (!arr.length) {
        setError('Only PDF, TXT, and MD files are supported.')
        return
      }
      setError(null)
      setUploading(true)
      try {
        await uploadFiles(arr)
        onDocsChange()
      } catch (e: any) {
        setError(e.message ?? 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [onDocsChange]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const handleClear = async () => {
    if (!docs.length) return
    if (!confirm('Clear all documents and reset the index?')) return
    await clearDocuments()
    onDocsChange()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 48, borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Library</span>
        </div>
        {docs.length > 0 && (
          <button
            onClick={handleClear}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget
              b.style.color = 'var(--error)'
              b.style.borderColor = 'rgba(224,90,90,0.4)'
              b.style.background = 'rgba(224,90,90,0.08)'
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget
              b.style.color = 'var(--text-muted)'
              b.style.borderColor = 'var(--border)'
              b.style.background = 'transparent'
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div style={{ padding: '12px 12px 8px' }}>
        <div
          className={dragActive ? 'drop-zone-active' : ''}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 12,
            padding: '18px 12px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragActive ? 'var(--accent-glow)' : 'var(--bg-base)',
            transition: 'all 0.2s',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          {/* Animated gradient border on hover */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none',
            background: dragActive ? 'radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 70%)' : 'none',
          }} />

          {uploading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div className="spinner" />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Indexing…</span>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
              </div>
              <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: '0 0 3px' }}>
                Drop files or click to upload
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>PDF · TXT · MD</p>
            </div>
          )}
        </div>

        {error && (
          <p style={{ fontSize: 11, marginTop: 6, color: 'var(--error)', textAlign: 'center' }}>{error}</p>
        )}
      </div>

      {/* Corpus stats — metric cards */}
      {docs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '0 12px 10px' }}>
          <StatCard value={docs.length} label="docs" />
          <StatCard value={totalChunks} label="chunks" />
          <StatCard value={fmtTokens(totalTokens)} label="tokens" />
        </div>
      )}

      {/* Document list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {docs.length === 0 && !uploading && (
          <p style={{ fontSize: 12, textAlign: 'center', color: 'var(--text-muted)', marginTop: 20 }}>
            No documents yet
          </p>
        )}
        {docs.map((doc) => (
          <DocCard key={doc.id} doc={doc} onPreview={() => setPreviewDocId(doc.id)} />
        ))}
      </div>

      {/* Document preview modal */}
      {previewDocId && (
        <DocPreviewModal
          doc={docs.find((d) => d.id === previewDocId)!}
          onClose={() => setPreviewDocId(null)}
        />
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{
      borderRadius: 8, padding: '8px 6px', textAlign: 'center',
      background: 'var(--bg-base)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

// ── Doc card ──────────────────────────────────────────────────────────────────

function DocCard({ doc, onPreview }: { doc: DocMeta; onPreview: () => void }) {
  const ext = doc.filename.split('.').pop()?.toUpperCase() ?? '?'
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="animate-fade-in"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 9, padding: '10px 12px',
        background: hovered ? 'var(--bg-surface2)' : 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        cursor: 'pointer',
        transition: 'all 0.18s',
      }}
      onClick={onPreview}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
          padding: '2px 5px', borderRadius: 4, flexShrink: 0, marginTop: 1,
          background: 'var(--accent-dim)', color: 'var(--accent)',
          border: '1px solid rgba(79,123,255,0.25)',
          letterSpacing: '0.05em',
        }}>
          {ext}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.filename}>
            {doc.filename}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {doc.chunk_count} chunks
            </span>
            <span style={{ fontSize: 11, color: 'var(--border-hover)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {fmtTokens(doc.total_tokens)} tok
            </span>
          </div>
          {/* Mini chunk count bar */}
          <div style={{ marginTop: 6, height: 2, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: 'linear-gradient(90deg, var(--accent), #7b61ff)',
              width: `${Math.min(100, (doc.chunk_count / 20) * 100)}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
        {hovered && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </div>
    </div>
  )
}

// ── Document preview modal ────────────────────────────────────────────────────

function DocPreviewModal({ doc, onClose }: { doc: DocMeta; onClose: () => void }) {
  const [chunks, setChunks] = useState<ChunkPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchDocumentChunks(doc.id)
      .then((data) => setChunks(data.chunks))
      .catch((e) => setFetchError(e.message ?? 'Failed to load chunks'))
      .finally(() => setLoading(false))
  }, [doc.id])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        className="animate-slide-in-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%', maxWidth: 640,
          maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div style={{
            padding: '3px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
            fontFamily: 'monospace', letterSpacing: '0.05em',
            background: 'var(--accent-dim)', color: 'var(--accent)',
            border: '1px solid rgba(79,123,255,0.25)',
          }}>
            {doc.filename.split('.').pop()?.toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.filename}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              {doc.chunk_count} chunks · {fmtTokens(doc.total_tokens)} tokens
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface2)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Chunk list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
              <div className="spinner" />
              Loading chunks…
            </div>
          )}
          {fetchError && (
            <p style={{ color: 'var(--error)', fontSize: 13, textAlign: 'center', padding: 20 }}>{fetchError}</p>
          )}
          {!loading && !fetchError && chunks.map((chunk) => (
            <div
              key={chunk.id}
              className="animate-fade-in"
              style={{
                borderRadius: 10, padding: '12px 14px',
                background: 'var(--bg-base)', border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                  background: 'var(--bg-surface2)', color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}>
                  #{chunk.chunk_index}
                </span>
                {chunk.page && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>p.{chunk.page}</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{chunk.tokens} tok</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {chunk.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
