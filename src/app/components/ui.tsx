/**
 * The control vocabulary from the "Modernist" design system in `design/`.
 *
 * Three rules carry the look and none of them are negotiable: **square
 * corners** (radius 0 everywhere), **Archivo 800** on anything that acts as a
 * heading or a button, and a single vermilion accent used sparingly. Colours
 * come only from tokens, so a retune happens in `tokens.css` alone.
 */

import type { CSSProperties, ReactNode } from 'react'

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  block,
  title,
  type = 'button',
  style,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  block?: boolean
  title?: string
  type?: 'button' | 'submit'
  style?: CSSProperties
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 cursor-pointer font-heading font-extrabold ' +
    'text-sm leading-tight border border-transparent px-3 py-2 rounded-none ' +
    'transition-colors duration-[var(--duration-fast)] disabled:opacity-45 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-accent text-on-accent hover:bg-accent-600',
    secondary: 'border-divider text-text hover:bg-[var(--hover)]',
    ghost: 'text-accent px-1 hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      className={`${base} ${variants} ${block ? 'w-full' : ''}`}
    >
      {children}
    </button>
  )
}

/** 36x36 square icon button, per the design's `.btn-icon`. */
export function IconButton({
  children,
  onClick,
  title,
  disabled,
  active,
}: {
  children: ReactNode
  onClick?: () => void
  title: string
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`grid h-9 w-9 place-items-center border transition-colors duration-[var(--duration-fast)] disabled:opacity-45 disabled:cursor-not-allowed ${
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-divider hover:bg-[var(--hover)]'
      }`}
    >
      {children}
    </button>
  )
}

/** A titled block in the right-hand properties panel. */
export function Section({
  title,
  children,
  action,
  last,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
  last?: boolean
}) {
  return (
    <section
      className={`flex flex-col gap-3 px-6 py-5 ${last ? '' : 'border-b-2 border-divider'}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-2">
          <h6 className="text-muted">{title}</h6>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

/** Segmented control (`.seg`): a hairline box, the active option filled. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
  columns?: number
}) {
  return (
    <div
      className="inline-flex overflow-hidden border border-divider"
      style={columns ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
      role="group"
    >
      {options.map((option, i) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 text-[13px] transition-colors duration-[var(--duration-fast)] disabled:opacity-40 disabled:cursor-not-allowed ${
              i > 0 ? 'border-l border-divider' : ''
            } ${
              selected
                ? 'bg-accent text-on-accent font-bold'
                : 'hover:bg-[var(--hover)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Slider with its value shown, double-click to reset (DESIGN_BRIEF §6). */
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
    <label className={`block ${disabled ? 'opacity-45' : ''}`} title="Double-click to reset">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="tabular font-bold">{format ? format(value) : value}</span>
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
        className="w-full cursor-pointer"
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
      className={`h-12 w-full transition-shadow duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-35 ${
        selected
          ? 'outline outline-2 outline-offset-2 outline-accent'
          : 'outline outline-1 outline-offset-0 outline-[var(--color-divider)] hover:outline-2'
      }`}
      style={{ backgroundColor: hex }}
    />
  )
}

/**
 * Inline notice. The design marks these with a 2 px coloured top rule rather
 * than a box, which keeps them quiet until they matter.
 */
export function Notice({
  tone,
  children,
  action,
  icon,
}: {
  tone: 'info' | 'ok' | 'warn' | 'danger'
  children: ReactNode
  action?: ReactNode
  icon?: ReactNode
}) {
  const styles = {
    info: { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', line: 'var(--color-accent)' },
    ok: { background: 'var(--ok-bg)', color: 'var(--ok)', line: 'var(--ok-line)' },
    warn: { background: 'var(--warn-bg)', color: 'var(--warn)', line: 'var(--warn-line)' },
    danger: { background: 'var(--danger-bg)', color: 'var(--danger)', line: 'var(--danger)' },
  }[tone]
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 text-[15px]"
      style={{
        background: styles.background,
        color: styles.color,
        borderTop: `2px solid ${styles.line}`,
      }}
    >
      {icon}
      <span className="min-w-0">{children}</span>
      {action && <span className="ml-auto flex-none">{action}</span>}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-bold">{children}</dd>
    </>
  )
}

export function FieldList({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13px]">{children}</dl>
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  mono?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`min-h-9 w-full border border-divider bg-surface px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent disabled:opacity-45 ${
        mono ? 'tabular' : ''
      }`}
      style={{ caretColor: 'var(--color-accent)' }}
    />
  )
}

/** The app mark, exactly as drawn in the design. */
export function AppMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="ID Photo Studio">
      <rect width="32" height="32" fill="#ec3013" />
      <rect x="8" y="6" width="16" height="20" fill="#ffffff" />
      <circle cx="16" cy="14" r="4" fill="#ec3013" />
      <path d="M10 26a6 6 0 0 1 12 0z" fill="#ec3013" />
    </svg>
  )
}

/** Lucide-style outline icons, 24x24, stroke 2 (DESIGN_BRIEF §5). */
export function Icon({
  path,
  size = 20,
  strokeWidth = 2,
}: {
  path: string | readonly string[]
  size?: number
  strokeWidth?: number
}) {
  const paths = Array.isArray(path) ? path : [path]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

export const ICONS = {
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8 12 3 7 8', 'M12 3v12'],
  check: 'M20 6 9 17l-5-5',
  close: ['M18 6 6 18', 'm6 6 12 12'],
  warning: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  undo: ['M3 7v6h6', 'M3 13a9 9 0 1 0 3-7.7L3 8'],
  redo: ['M21 7v6h-6', 'M21 13a9 9 0 1 1-3-7.7L21 8'],
  zoomIn: ['M11 8v6', 'M8 11h6', 'm21 21-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  zoomOut: ['M8 11h6', 'm21 21-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
  rotate: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  back: 'M9 14 4 9l5-5',
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
} as const
