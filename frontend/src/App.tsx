import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDocuments, streamQuery } from './api'
import { ChatInput } from './components/ChatInput'
import { ChatMessage } from './components/ChatMessage'
import { ContextInspector } from './components/ContextInspector'
import { DocumentLibrary } from './components/DocumentLibrary'
import type { ChunkResult, DocMeta, HistoryMessage, LatencyInfo, Message, Toast } from './types'
import './index.css'

let msgCounter = 0
const newId = () => String(++msgCounter)

let toastCounter = 0
const newToastId = () => String(++toastCounter)

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

export default function App() {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [totalChunks, setTotalChunks] = useState(0)
  const [totalTokens, setTotalTokens] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const [inspectorChunks, setInspectorChunks] = useState<ChunkResult[]>([])
  const [inspectorTokens, setInspectorTokens] = useState(0)
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null)

  const [mobilePanel, setMobilePanel] = useState<'library' | 'inspector' | null>(null)

  const isDesktop = useIsDesktop()
  const bottomRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((message: string) => {
    const id = newToastId()
    setToasts((prev) => [...prev, { id, message, exiting: false }])
    setTimeout(() => {
      // Mark as exiting for exit animation
      setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220)
    }, 1800)
  }, [])

  const loadDocs = useCallback(async () => {
    try {
      const data = await fetchDocuments()
      setDocs(data.documents)
      setTotalChunks(data.total_chunks)
      setTotalTokens(data.total_tokens)
    } catch {
      /* backend starting up */
    }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Ctrl/Cmd+K → clear chat
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (streaming) return
        setMessages([])
        setInspectorChunks([])
        setInspectorTokens(0)
        setHighlightedChunkId(null)
        showToast('Chat cleared')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [streaming, showToast])

  const handleSend = useCallback(
    async (question: string) => {
      if (streaming) return

      const userMsg: Message = { id: newId(), role: 'user', content: question }
      const assistantId = newId()
      const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true }

      // Build history from existing messages (skip empty, skip current streaming)
      const history: HistoryMessage[] = messages
        .filter((m) => m.content.trim() && !m.streaming)
        .map((m) => ({ role: m.role, content: m.content }))

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setStreaming(true)
      setHighlightedChunkId(null)

      try {
        await streamQuery(question, 5, history, {
          onRetrieval(chunks) {
            setInspectorChunks(chunks)
            if (!isDesktop) setMobilePanel('inspector')
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, chunks } : m)
            )
          },
          onTtft() {},
          onToken(text) {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + text } : m)
            )
          },
          onDone(latency: LatencyInfo) {
            setInspectorTokens(latency.context_tokens)
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, streaming: false, latency } : m)
            )
            setStreaming(false)
          },
          onError(msg) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: `**Error:** ${msg}`, streaming: false } : m
              )
            )
            setStreaming(false)
          },
        })
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: 'Connection error.', streaming: false } : m
            )
          )
        }
        setStreaming(false)
      }
    },
    [streaming, isDesktop, messages]
  )

  const handleCitationClick = useCallback((chunkId: string) => {
    setHighlightedChunkId((prev) => (prev === chunkId ? null : chunkId))
    if (!isDesktop) setMobilePanel('inspector')
  }, [isDesktop])

  const hasDocuments = docs.length > 0

  const chatPanel = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 20px' }}>
        {messages.length === 0 && (
          <EmptyState hasDocuments={hasDocuments} onSend={streaming ? undefined : handleSend} />
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onCitationClick={handleCitationClick}
            highlightedChunkId={highlightedChunkId}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={handleSend} disabled={streaming} hasDocuments={hasDocuments} />
    </>
  )

  // ── Desktop: three-column fixed layout ───────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)', position: 'relative' }}>
        <ToastContainer toasts={toasts} />

        {/* Left sidebar */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DocumentLibrary docs={docs} totalChunks={totalChunks} totalTokens={totalTokens} onDocsChange={loadDocs} />
        </div>

        {/* Center chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: 'var(--bg-base)' }}>
          <DesktopHeader />
          {chatPanel}
        </div>

        {/* Right inspector */}
        <div style={{ width: 316, flexShrink: 0, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ContextInspector
            chunks={inspectorChunks}
            highlightedChunkId={highlightedChunkId}
            contextTokens={inspectorTokens}
          />
        </div>
      </div>
    )
  }

  // ── Mobile: single column + slide-in drawers ─────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)', position: 'relative' }}>
      <ToastContainer toasts={toasts} />
      <MobileHeader
        onLibrary={() => setMobilePanel(mobilePanel === 'library' ? null : 'library')}
        onInspector={() => setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector')}
      />
      {mobilePanel && (
        <div
          onClick={() => setMobilePanel(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
        />
      )}
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 30, transform: mobilePanel === 'library' ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
        <DocumentLibrary docs={docs} totalChunks={totalChunks} totalTokens={totalTokens} onDocsChange={loadDocs} />
      </div>
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 316, zIndex: 30, transform: mobilePanel === 'inspector' ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
        <ContextInspector chunks={inspectorChunks} highlightedChunkId={highlightedChunkId} contextTokens={inspectorTokens} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {chatPanel}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null
  return (
    <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={t.exiting ? 'toast-exit' : 'toast-enter'}
          style={{
            background: 'var(--bg-surface2)',
            border: '1px solid var(--border-hover)',
            color: 'var(--text-primary)',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {t.message}
        </div>
      ))}
    </div>
  )
}

function DesktopHeader() {
  return (
    <div
      className="gradient-border-bottom"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px',
        height: 48, background: 'var(--bg-surface)', flexShrink: 0,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="live-dot" />
      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
        Librarian
      </span>
      <span
        style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 6,
          background: 'var(--accent-dim)', color: 'var(--accent)',
          border: '1px solid rgba(79,123,255,0.3)',
          fontWeight: 500,
          boxShadow: '0 0 8px var(--accent-glow)',
        }}
      >
        for Pacific
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
        ⌘K to clear
      </span>
    </div>
  )
}

function MobileHeader({ onLibrary, onInspector }: { onLibrary: () => void; onInspector: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 48, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <button onClick={onLibrary} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="live-dot" style={{ width: 6, height: 6 }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Librarian</span>
      </div>
      <button onClick={onInspector} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </button>
    </div>
  )
}

function EmptyState({ hasDocuments, onSend }: { hasDocuments: boolean; onSend?: (q: string) => void }) {
  const prompts = [
    'What are the main topics covered?',
    'Summarize the key findings.',
    'What does the document say about…?',
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: '40px 24px' }}>
      {/* Glowing book illustration */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 40px var(--accent-glow)' }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="bookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4f7bff"/>
                <stop offset="100%" stopColor="#7b61ff"/>
              </linearGradient>
            </defs>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="url(#bookGrad)" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="url(#bookGrad)" strokeWidth="1.5"/>
            <line x1="9" y1="7" x2="15" y2="7" stroke="url(#bookGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
            <line x1="9" y1="10" x2="17" y2="10" stroke="url(#bookGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
            <line x1="9" y1="13" x2="13" y2="13" stroke="url(#bookGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
          </svg>
        </div>
        {/* Light rays */}
        <div style={{ position: 'absolute', inset: -16, borderRadius: '50%', background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)', pointerEvents: 'none' }} />
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
        {hasDocuments ? 'What would you like to know?' : 'Welcome to Librarian'}
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 320, lineHeight: 1.65, margin: 0 }}>
        {hasDocuments
          ? 'Your documents are indexed and ready. Every answer cites its sources — click any citation to see the exact chunk.'
          : 'Upload PDF, TXT, or Markdown files from the left panel to get started. Ask questions, get cited answers.'}
      </p>

      {hasDocuments && onSend && (
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 340 }}>
          {prompts.map((s) => (
            <button
              key={s}
              className="shimmer-hover"
              onClick={() => onSend(s)}
              style={{
                borderRadius: 10,
                padding: '10px 14px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'border-color 0.2s, color 0.2s',
                width: '100%',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
