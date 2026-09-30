import { afterEach, describe, expect, it } from 'vitest';
import {
  adoptSessionAccount,
  getSessionChange,
  getTabAccount,
  observeSessionUser,
  reportSessionMismatch,
  resetSessionGuard,
  sessionHeaders,
} from './session-guard';

const nusrat = { id: 'u-nusrat', name: 'Nusrat Jahan', role: 'PASSENGER' as const };
const jashim = { id: 'u-jashim', name: 'Jashim Uddin', role: 'DRIVER' as const };

afterEach(() => resetSessionGuard());

describe('session guard (one account per tab)', () => {
  it('the first signed-in user claims the tab; the same user keeps it', () => {
    expect(observeSessionUser(nusrat)).toBe(true);
    expect(observeSessionUser(nusrat)).toBe(true);
    expect(getTabAccount()?.id).toBe('u-nusrat');
    expect(getSessionChange()).toBeNull();
  });

  it('a different account in /auth/me pauses the tab instead of switching it', () => {
    observeSessionUser(nusrat);
    expect(observeSessionUser(jashim)).toBe(false);
    expect(getSessionChange()).toEqual({ tab: nusrat, current: jashim });
    // The tab still belongs to Nusrat: requests keep naming her, so the API refuses them.
    expect(sessionHeaders('/rides')).toEqual({ 'x-session-user': 'u-nusrat' });
  });

  it('sends the tab account on API calls, but never on /auth/* (which must answer for the real session)', () => {
    expect(sessionHeaders('/rides')).toEqual({});
    observeSessionUser(nusrat);
    expect(sessionHeaders('/rides')).toEqual({ 'x-session-user': 'u-nusrat' });
    expect(sessionHeaders('/auth/me')).toEqual({});
  });

  it('a refused request pauses the tab and fills in the account once /auth/me answers', () => {
    observeSessionUser(nusrat);
    reportSessionMismatch();
    expect(getSessionChange()).toEqual({ tab: nusrat, current: undefined });
    observeSessionUser(jashim);
    expect(getSessionChange()).toEqual({ tab: nusrat, current: jashim });
  });

  it('signing in from this tab re-claims it without pausing', () => {
    observeSessionUser(nusrat);
    adoptSessionAccount(jashim);
    expect(observeSessionUser(jashim)).toBe(true);
    expect(getSessionChange()).toBeNull();
  });

  it('signed-out answers never pause the tab (the usual "session ended" flow handles them)', () => {
    observeSessionUser(nusrat);
    expect(observeSessionUser(null)).toBe(true);
    expect(getSessionChange()).toBeNull();
  });
});
