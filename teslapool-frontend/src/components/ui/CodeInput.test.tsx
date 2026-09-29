import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CodeInput } from './CodeInput';

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [v, setV] = useState('');
  return <CodeInput value={v} onChange={setV} onComplete={onComplete} />;
}

describe('CodeInput', () => {
  it('fills every box from a pasted code and reports completion once', () => {
    const done = vi.fn();
    render(<Harness onComplete={done} />);
    fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), { clipboardData: { getData: () => '482 913' } });
    expect(screen.getAllByRole('textbox').map((i) => (i as HTMLInputElement).value).join('')).toBe('482913');
    expect(done).toHaveBeenCalledWith('482913');
  });

  it('ignores letters and moves back on Backspace', () => {
    render(<Harness onComplete={vi.fn()} />);
    const first = screen.getByLabelText('Digit 1 of 6');
    fireEvent.change(first, { target: { value: 'a' } });
    expect((first as HTMLInputElement).value).toBe('');
    fireEvent.change(first, { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Digit 2 of 6'), { target: { value: '8' } });
    fireEvent.keyDown(screen.getByLabelText('Digit 3 of 6'), { key: 'Backspace' });
    expect((screen.getByLabelText('Digit 2 of 6') as HTMLInputElement).value).toBe('');
    expect((first as HTMLInputElement).value).toBe('4');
  });
});
