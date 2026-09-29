import clsx from 'clsx';
import { useId } from 'react';

/** Label + control + hint/error, wired with aria-describedby and aria-invalid. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className={clsx('mt-1.5 text-xs text-muted')}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}
