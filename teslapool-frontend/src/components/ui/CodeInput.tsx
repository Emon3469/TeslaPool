'use client';

import clsx from 'clsx';
import { useRef } from 'react';

/**
 * Six single-digit boxes that behave like one field: typing advances, Backspace goes back,
 * arrows move, and pasting "482 913" or "482913" fills every box. `autoComplete="one-time-code"`
 * lets phones offer the code from the email or SMS keyboard suggestion.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  label = 'Verification code',
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  function setFrom(index: number, raw: string) {
    const incoming = raw.replace(/\D/g, '');
    if (!incoming) return;
    const next = (value.slice(0, index) + incoming).slice(0, length);
    onChange(next);
    focus(next.length);
    if (next.length === length) onComplete?.(next);
  }

  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2 sm:gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={length}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setFrom(i, e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            setFrom(0, e.clipboardData.getData('text'));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (d) onChange(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) {
                onChange(value.slice(0, i - 1) + value.slice(i));
                focus(i - 1);
              }
            } else if (e.key === 'ArrowLeft') focus(i - 1);
            else if (e.key === 'ArrowRight') focus(i + 1);
          }}
          className={clsx(
            'h-14 w-11 rounded-xl border-2 bg-cream text-center text-2xl font-black tabular-nums text-dark transition focus:border-dark focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/60 disabled:opacity-50 sm:h-16 sm:w-12',
            invalid ? 'border-red-400' : d ? 'border-dark' : 'border-dark/15',
          )}
        />
      ))}
    </div>
  );
}
