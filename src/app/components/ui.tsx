/**
 * The small set of controls the whole app is built from.
 *
 * DESIGN_BRIEF §5: comfortable density, big hit targets on primary actions,
 * one confident accent, tabular numerals on anything measured. Every colour
 * comes from a token in `styles/tokens.css`, so the design system can be
 * swapped without touching a component.
 */

import type { ReactNode } from 'react'

export function Panel({
  title,
  children,
  action,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-md border border-border bg-surface-raised p-3 shadow-sm">
      {title && (
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  size = 'md',
  type = 'button',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  size?: 'md' | 'lg'
  type?: 'button' | 'submit'
  title?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded font-medium transition-colors ' +
    'duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-50'
  const sizes = size === 'lg' ? 'px-5 py-2.5 text-base' : 'px-3 py-2 text-sm'
  const variants = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover',
    secondary: 'border border-border-strong bg-surface text-text hover:bg-accent-soft',
    ghost: 'text-text-muted hover:bg-accent-soft hover:text-text',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes} ${variants}`}
    >
      {children}
    </button>
  )
}

/**
 * A labelled slider that shows its value and resets on double-click
 * (DESIGN_BRIEF §6).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  format,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  format?: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <label className={`block ${disabled ? 'opacity-50' : ''}`}>
      <span className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-text-muted">{label}</span>
        <span className="tabular text-text">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-sm bg-border accent-accent"
      />
    </label>
  )
}

export function Swatch({
  hex,
  label,
  selected,
  onSelect,
  disabled,
}: {
  hex: string
  label: string
  selected: boolean
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`h-11 rounded-sm border-2 transition-[border-color,transform] duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-border-strong hover:border-text-subtle'
      }`}
      style={{ backgroundColor: hex }}
    />
  )
}

export function Banner({
  tone,
  children,
  action,
}: {
  tone: 'info' | 'success' | 'warning' | 'danger'
  children: ReactNode
  action?: ReactNode
}) {
  const styles = {
    info: 'bg-accent-soft text-accent border-accent/30',
    success: 'bg-success-soft text-success border-success/30',
    warning: 'bg-warning-soft text-warning border-warning/30',
    danger: 'bg-danger-soft text-danger border-danger/30',
  }[tone]
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-sm border px-2.5 py-2 text-sm ${styles}`}
    >
      <span>{children}</span>
      {action}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text">{children}</dd>
    </>
  )
}

export function FieldList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">{children}</dl>
  )
}

/** Indeterminate-to-determinate progress used during segmentation. */
export function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-sm bg-border">
      <div
        className="h-full rounded-sm bg-accent transition-[width] duration-[var(--duration-step)] ease-[var(--ease-standard)]"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  )
}

export function AppMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="2" y="6" width="28" height="20" rx="4" fill="var(--color-accent)" />
      <rect x="5.5" y="9.5" width="11" height="13" rx="2" fill="#fff" />
      <circle cx="11" cy="14.5" r="2.6" fill="var(--color-accent)" />
      <path d="M6.6 22.5a4.4 4.4 0 0 1 8.8 0z" fill="var(--color-accent)" />
      <g fill="#fff" opacity="0.8">
        <rect x="19" y="11" width="8" height="1.8" rx="0.9" />
        <rect x="19" y="15" width="9" height="1.8" rx="0.9" />
        <rect x="19" y="19" width="6" height="1.8" rx="0.9" />
      </g>
    </svg>
  )
}
