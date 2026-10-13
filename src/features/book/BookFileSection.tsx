import { useEffect, useState } from 'react'

import { Button, Notice, Section } from '../../app/components/ui'
import { bookAutosaveClear, bookAutosaveRead } from '../../lib/tauri'
import { useBook } from '../../store/book'
import { fileNameOf } from '../../lib/bookFile'
import { locateMissing, openBookText, saveBook } from './bookProject'

export function BookFileSection() {
  const filePath = useBook((s) => s.filePath)
  const dirty = useBook((s) => s.dirty)
  const missing = useBook((s) => s.missing)
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  const run = async (task: () => Promise<string | null>, ok: string) => {
    try {
      const error = await task()
      setMessage(error ? { tone: 'danger', text: error } : { tone: 'ok', text: ok })
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <Section title="Book file">
      <p className="truncate text-xs text-muted" title={filePath ?? undefined}>
        {filePath ? fileNameOf(filePath) : 'Not saved yet'}
        {dirty ? ' · unsaved changes' : ''}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void run(async () => ((await saveBook()) ? null : 'Not saved.'), 'Saved.')}>Save</Button>
        <Button onClick={() => void run(async () => ((await saveBook(true)) ? null : 'Not saved.'), 'Saved.')}>Save as…</Button>
      </div>
      {missing.length > 0 && <Button onClick={() => void run(locateMissing, 'Photos found.')}>Locate photos…</Button>}
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
          <button type="button" className="font-bold underline" onClick={() => void openBookText(saved.text, null, true).then((e) => (e ? setError(e) : setSaved(null)))}>Restore</button>
          <button type="button" className="underline" onClick={() => void bookAutosaveClear().then(() => setSaved(null))}>Discard</button>
        </span>
      }
    >
      Restore the unsaved book from {when}?
    </Notice>
  )
}
