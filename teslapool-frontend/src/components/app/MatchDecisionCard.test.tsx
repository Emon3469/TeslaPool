import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MatchDecision } from '@/lib/types';
import { MatchDecisionCard } from './MatchDecisionCard';

const base: MatchDecision = {
  decision: 'MATCHED',
  poolId: '00000000-0000-0000-0000-000000000001',
  headline: 'Matched: Banani → Gulshan 1 → Mohakhali',
  reasonCodes: ['CAPACITY_AVAILABLE'],
  checks: [
    { rule: 'capacity', passed: true, code: 'CAPACITY_AVAILABLE', message: '2 seats available, 1 requested', detail: {} },
    { rule: 'detour', passed: true, code: 'DETOUR_WITHIN_LIMIT', message: 'Detour 1.1 km for Nusrat (limit 3 km)', detail: {} },
  ],
  capacity: { total: 3, before: 1, requested: 1, after: 2, available: 2 },
  route: ['BANANI', 'GULSHAN', 'MOHAKHALI'],
  detourKm: 1.1,
  totalDistanceKm: 4.5,
  fare: { soloFarePoysha: 10625, farePoysha: 7969, discountBps: 2500, discountPercent: 25, sharedFraction: 1, soloFareBdt: 106.25, fareBdt: 79.69 },
  alternatives: [],
};

describe('MatchDecisionCard', () => {
  it('shows the verdict, pooled fare, saving and seat change', () => {
    render(<MatchDecisionCard decision={base} />);
    expect(screen.getByText(base.headline)).toBeInTheDocument();
    expect(screen.getByText('৳79.69')).toBeInTheDocument();
    expect(screen.getByText('৳106.25')).toBeInTheDocument();
    expect(screen.getByText('Seats 1/3 → 2/3')).toBeInTheDocument();
  });

  it('reveals every rule check on demand', () => {
    render(<MatchDecisionCard decision={base} />);
    expect(screen.queryByText('2 seats available, 1 requested')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /why/i }));
    expect(screen.getByText('2 seats available, 1 requested')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /why/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('explains a rejection and does not change the seat count', () => {
    const rejected: MatchDecision = {
      ...base,
      decision: 'REJECTED',
      headline: 'Not matched: Only 1 seat left, 2 requested',
      checks: [{ rule: 'capacity', passed: false, code: 'CAPACITY_EXCEEDED', message: 'Only 1 seat left, 2 requested', detail: {} }],
      capacity: { total: 3, before: 2, requested: 2, after: 4, available: 1 },
      fare: undefined,
    };
    render(<MatchDecisionCard decision={rejected} defaultOpen />);
    expect(screen.getByText('Seats 2/3 → 2/3')).toBeInTheDocument();
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
    expect(screen.queryByText('৳79.69')).not.toBeInTheDocument();
  });
});
