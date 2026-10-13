import { useEffect, useState } from 'react'

import { Button, Notice, Section } from '../../app/components/ui'
import { bookAutosaveClear, bookAutosaveRead } from '../../lib/tauri'
import { useBook } from '../../store/book'
import { fileNameOf, readAutosave } from '../../lib/bookFile'
import { locateMissing, openBookText, saveBookWithFeedback } from './bookProject'

export function BookFileSection() {
  const filePath = useBook((s) => s.filePath)
  const dirty = useBook((s) => s.dirty)
  const missing = useBook((s) => s.missing)
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  const [locating, setLocating] = useState(false)
  const run = async (task: () => Promise<string | null>, ok: string) => {
    try {
      const error = await task()
      setMessage(error ? { tone: 'danger', text: error } : { tone: 'ok', text: ok })
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : String(error) })
    }
  }
  const save = async (saveAs: boolean) => {
    // A failure is already shown in a dialog by the helper; a cancel says nothing.
    const result = await saveBookWithFeedback(saveAs)
    setMessage(result.kind === 'saved' ? { tone: 'ok', text: 'Saved.' } : null)
  }
  return (
    <Section title="Book file">
      <p className="truncate text-xs text-muted" title={filePath ?? undefined}>
        {filePath ? fileNameOf(filePath) : 'Not saved yet'}
        {dirty ? ' · unsaved changes' : ''}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void save(false)}>Save</Button>
        <Button onClick={() => void save(true)}>Save as…</Button>
      </div>
      {missing.length > 0 && (
        <Button
          disabled={locating}
          onClick={() => {
            setLocating(true)
            void run(locateMissing, 'Photos found.').finally(() => setLocating(false))
          }}
        >
          {locating ? 'Locating photos…' : 'Locate photos…'}
        </Button>
      )}
      {message && <Notice tone={message.tone} action={<button type="button" onClick={() => setMessage(null)}>OK</button>}>{message.text}</Notice>}
    </Section>
  )
}

/** On Import: offer the book that was open when the app last closed unexpectedly. */
export function AutosaveOffer() {
  const [saved, setSaved] = useState<{ text: string; savedAtMs: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    bookAutosaveRead().then(setSaved).catch(() => setSaved(null))
  }, [])
  if (!saved) return error ? <Notice tone="danger">{error}</Notice> : null
  const when = new Date(saved.savedAtMs).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })
  return (
    <Notice
      tone="info"
      action={
        <span className="flex gap-3">
          <button type="button" className="font-bold underline" onClick={() => {
              const restored = readAutosave(saved.text)
              void openBookText(restored.text, restored.path, true).then((e) => (e ? setError(e) : setSaved(null)))
            }}>Restore</button>
          <button type="button" className="underline" onClick={() => void bookAutosaveClear().then(() => setSaved(null))}>Discard</button>
        </span>
      }
    >
      Restore the unsaved book from {when}?
    </Notice>
  )
}
