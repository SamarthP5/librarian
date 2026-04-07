import { useEffect, useRef, useState } from 'react'

interface Props {
  onSend: (text: string) => void
  disabled: boolean
  hasDocuments: boolean
}

export function ChatInput({ onSend, disabled, hasDocuments }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus()
  }, [disabled])

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled || !hasDocuments) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const canSend = value.trim() && !disabled && hasDocuments
  const placeholder = !hasDocuments
    ? 'Upload documents to get started…'
    : disabled
    ? 'Generating answer…'
    : 'Ask a question… (Enter to send, Shift+Enter for newline)'

  return (
    <div
      style={{
        padding: '12px 16px 14px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* Input container with gradient border + glow */}
      <div
        className={focused ? 'input-glow' : ''}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          borderRadius: 14,
          padding: '10px 12px',
          background: 'var(--bg-base)',
          border: `1px solid ${focused ? 'rgba(79,123,255,0.4)' : 'var(--border)'}`,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          position: 'relative',
        }}
      >
        {/* Subtle gradient overlay inside */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 14, pointerEvents: 'none',
          background: 'linear-gradient(135deg, rgba(79,123,255,0.02) 0%, transparent 60%)',
        }} />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled || !hasDocuments}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            fontSize: 14,
            outline: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            minHeight: 32,
            maxHeight: 160,
            lineHeight: 1.65,
            fontFamily: 'inherit',
            border: 'none',
            padding: 0,
            position: 'relative',
            zIndex: 1,
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            cursor: canSend ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: canSend
              ? 'linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)'
              : 'var(--bg-surface2)',
            color: canSend ? '#fff' : 'var(--text-muted)',
            boxShadow: canSend ? '0 2px 12px rgba(79,123,255,0.35)' : 'none',
            transition: 'transform 0.15s, box-shadow 0.15s, background 0.2s',
            position: 'relative',
            zIndex: 1,
          }}
          onMouseEnter={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
          onMouseDown={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.94)' }}
          onMouseUp={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)' }}
        >
          {disabled ? (
            <div className="spinner" style={{ width: 14, height: 14 }} />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22 2L11 13" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" fill="currentColor"/>
            </svg>
          )}
        </button>
      </div>

      <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 8, letterSpacing: '0.01em' }}>
        Shift+Enter for newline · Answers cite sources · ⌘K to clear
      </p>
    </div>
  )
}
