/**
 * The licence screen — Settings on the header opens this.
 *
 * It has one job at a counter: show the Machine ID big enough to read out
 * over the phone, and take the key that comes back. Everything else is
 * secondary, so the ID and the key box are the only things above the fold.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { Button, Icon, ICONS, Notice } from '../../app/components/ui'
import { activateLicense, licenseStatus, type LicenseStatus } from '../../lib/tauri'

interface LicenseContextValue {
  status: LicenseStatus | null
  /** False once the trial is over: saving, exporting and printing are off. */
  canProduce: boolean
  refresh: () => void
  open: () => void
}

const LicenseContext = createContext<LicenseContextValue>({
  status: null,
  canProduce: true,
  refresh: () => undefined,
  open: () => undefined,
})

export function useLicense() {
  return useContext(LicenseContext)
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [showing, setShowing] = useState(false)

  const refresh = useCallback(() => {
    licenseStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // An expired trial is shown once on startup rather than at the moment the
  // operator presses Print with a customer waiting.
  useEffect(() => {
    if (status?.state === 'expired') setShowing(true)
  }, [status?.state])

  return (
    <LicenseContext.Provider
      value={{
        status,
        // Until the check answers, assume it is fine: a slow first read must
        // never block a shop that has paid.
        canProduce: status ? status.state !== 'expired' : true,
        refresh,
        open: () => setShowing(true),
      }}
    >
      {children}
      {showing && (
        <LicenseDialog
          status={status}
          onClose={() => setShowing(false)}
          onActivated={(next) => setStatus(next)}
        />
      )}
    </LicenseContext.Provider>
  )
}

function LicenseDialog({
  status,
  onClose,
  onActivated,
}: {
  status: LicenseStatus | null
  onClose: () => void
  onActivated: (status: LicenseStatus) => void
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const expired = status?.state === 'expired'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const activate = () => {
    setBusy(true)
    setError(null)
    activateLicense(key)
      .then((next) => {
        onActivated(next)
        setKey('')
        onClose()
      })
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBusy(false))
  }

  const copyId = () => {
    if (!status) return
    void navigator.clipboard.writeText(status.machineId).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'color-mix(in srgb, var(--color-neutral-900) 55%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="flex w-[min(520px,100%)] flex-col gap-4 p-5 shadow-lg"
        style={{ background: 'var(--color-surface)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-heading text-xl font-extrabold">Licence</h4>
            <p className="text-sm text-muted">{describe(status)}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-text">
            <Icon path={ICONS.close} size={16} />
          </button>
        </div>

        {expired && (
          <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>
            {status?.note ??
              'The trial has ended. Photos still open and edit, but saving and printing need a licence.'}
          </Notice>
        )}
        {!expired && status?.note && <Notice tone="warn">{status.note}</Notice>}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">This computer's Machine ID</span>
          <div className="flex items-center gap-2">
            <code
              className="tabular flex-1 border border-divider px-3 py-2 text-lg font-bold tracking-[0.06em]"
              style={{ background: 'var(--color-bg)' }}
            >
              {status?.machineId ?? '…'}
            </code>
            <Button onClick={copyId}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <span className="text-xs text-muted">
            Send this to Philmer Digi Art to get a licence key. A key works on this computer only.
          </span>
        </div>

        {status?.state !== 'licensed' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Licence key</span>
            <textarea
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="PHILMER-…"
              rows={3}
              spellCheck={false}
              className="tabular w-full resize-none border border-divider bg-bg p-2 text-xs"
            />
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} disabled={busy}>
                Close
              </Button>
              <button
                type="button"
                onClick={activate}
                disabled={busy || key.trim() === ''}
                className="h-11 px-6 text-[15px] font-extrabold transition-colors duration-[var(--duration-fast)] disabled:opacity-45"
                style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
              >
                {busy ? 'Checking…' : 'Activate'}
              </button>
            </div>
          </div>
        )}

        {status?.state === 'licensed' && (
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function describe(status: LicenseStatus | null): string {
  if (!status) return 'Checking…'
  if (status.state === 'licensed') {
    const term =
      status.expiresInDays === null
        ? 'Licensed to this computer.'
        : `Licensed for ${status.expiresInDays} more ${status.expiresInDays === 1 ? 'day' : 'days'}.`
    return status.customer ? `${term} Customer ${status.customer}.` : term
  }
  if (status.state === 'trial') {
    return `Trial — ${status.daysLeft} of ${status.trialDays} ${
      status.daysLeft === 1 ? 'day' : 'days'
    } left.`
  }
  return 'The trial has ended.'
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/** The header chip: how long is left, and a way in to the licence screen. */
export function LicenseChip() {
  const { status, open } = useLicense()
  if (!status || status.state === 'licensed') return null

  const expired = status.state === 'expired'
  return (
    <button
      type="button"
      onClick={open}
      title="Licence"
      className="flex h-9 flex-none items-center px-3 text-[13px] font-bold 2xl:h-10"
      style={{
        background: expired ? 'var(--danger)' : 'var(--warn-bg)',
        color: expired ? '#fff' : 'var(--warn)',
      }}
    >
      {expired
        ? 'Trial ended — licence needed'
        : `Trial · ${status.daysLeft} ${status.daysLeft === 1 ? 'day' : 'days'} left`}
    </button>
  )
}
