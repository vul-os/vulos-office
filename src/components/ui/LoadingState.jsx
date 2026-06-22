/**
 * LoadingState + Skeleton — shared async-loading affordances.
 * ----------------------------------------------------------------------------
 * Replaces the scattered bare "loading…" strings and ad-hoc spinner divs with
 * one tokenised, accessible component.
 *
 *   <LoadingState />                       → centred spinner, fills its parent
 *   <LoadingState label="Loading docs" />  → spinner + caption (and aria-label)
 *   <LoadingState size="sm" inline />      → small inline spinner (no fill)
 *   <Skeleton className="h-4 w-32" />      → a single shimmer block
 *   <LoadingState.Lines count={3} />       → a stack of skeleton lines
 *
 * Accessibility:
 *   - role="status" + aria-live="polite" so screen readers announce loads.
 *   - the visible spinner is aria-hidden; the announcement comes from the label
 *     (defaults to "Loading…" so there is always something to read out).
 *
 * Motion: the spinner uses Tailwind's `animate-spin`; the skeleton shimmer is a
 * token-driven keyframe that respects prefers-reduced-motion (see index.css).
 */

import { Loader2 } from 'lucide-react'

const spinnerSize = {
  sm: 14,
  md: 20,
  lg: 26,
}

export function Skeleton({ className = '', rounded = 'rounded-md', ...rest }) {
  return (
    <div
      aria-hidden
      className={`skeleton-shimmer ${rounded} ${className}`}
      {...rest}
    />
  )
}

export default function LoadingState({
  label = 'Loading…',
  size = 'md',
  inline = false,
  showLabel = true,
  className = '',
}) {
  const px = spinnerSize[size] || spinnerSize.md

  if (inline) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={label}
        className={`inline-flex items-center gap-2 text-ink-faint ${className}`}
      >
        <Loader2 aria-hidden size={px} className="animate-spin text-accent" />
        {showLabel && <span className="text-sm">{label}</span>}
      </span>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`flex flex-1 flex-col items-center justify-center gap-3 py-10 text-ink-faint ${className}`}
    >
      <Loader2 aria-hidden size={px} className="animate-spin text-accent" />
      {showLabel && <p className="text-sm">{label}</p>}
    </div>
  )
}

// A stack of skeleton lines — convenient for list/card placeholders.
LoadingState.Lines = function LoadingLines({ count = 3, className = '' }) {
  return (
    <div aria-hidden className={`flex flex-col gap-2.5 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: `${90 - (i % 3) * 18}%` }}
        />
      ))}
    </div>
  )
}
