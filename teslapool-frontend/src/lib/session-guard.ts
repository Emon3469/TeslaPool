import type { User } from './types';

/**
 * One account per tab.
 *
 * Every tab of a browser shares the HttpOnly session cookie. Signing in as Jashim in one tab therefore
 * switches Nusrat's open tabs to Jashim too, and without a guard her next click would run as him (or
 * show his dashboard). Each tab remembers the account it loaded with:
 *  - the API client sends it as `X-Session-User`, and the API refuses (409 SESSION_ACCOUNT_CHANGED)
 *    when the cookie belongs to someone else, so nothing is read or changed as the other account;
 *  - `/auth/me` answers for a different account, and sign-in / sign-out broadcasts from other tabs,
 *    pause the tab until the person chooses what to do (see SessionGate).
 */

export type Account = Pick<User, 'id' | 'name' | 'role'>;

export interface SessionChange {
  /** The account this tab was showing. */
  tab: Account;
  /** Who the browser is signed in as now: null when signed out, undefined while still checking. */
  current: Account | null | undefined;
}

export const EXPECTED_USER_HEADER = 'x-session-user';
export const SESSION_CHANGED_CODE = 'SESSION_ACCOUNT_CHANGED';
const CHANNEL = 'tp-session';

let tabAccount: Account | null = null;
let change: SessionChange | null = null;
const listeners = new Set<() => void>();

const pick = (u: Account): Account => ({ id: u.id, name: u.name, role: u.role });

function notify() {
  // Callers may be rendering; let React finish before subscribers update state.
  queueMicrotask(() => listeners.forEach((l) => l()));
}

function flag(current: Account | null | undefined) {
  if (!tabAccount) return;
  if (change) {
    if (current !== undefined && change.current === undefined) {
      change = { ...change, current };
      notify();
    }
    return;
  }
  change = { tab: tabAccount, current };
  notify();
}

export function getTabAccount(): Account | null {
  return tabAccount;
}

export function getSessionChange(): SessionChange | null {
  return change;
}

export function subscribeSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Checks an `/auth/me` answer against this tab. The first signed-in answer claims the tab; a later
 * answer for someone else pauses it. Returns false when the user is not this tab's account.
 */
export function observeSessionUser(user: Account | null | undefined): boolean {
  if (!user) return true; // Signed out: the usual "session ended" flow handles it.
  if (!tabAccount) {
    tabAccount = pick(user);
    return true;
  }
  if (user.id === tabAccount.id) return true;
  flag(pick(user));
  return false;
}

/** This tab is about to become `user` (it just signed in or signed up): claim it and tell the other tabs. */
export function adoptSessionAccount(user: Account): void {
  tabAccount = pick(user);
  change = null;
  broadcast({ type: 'signed-in', account: tabAccount });
}

/** This tab signed out: tell the other tabs. */
export function announceSignOut(): void {
  broadcast({ type: 'signed-out' });
}

/** The API refused a request because the cookie belongs to another account. */
export function reportSessionMismatch(): void {
  flag(undefined);
}

/** Headers the API client adds so the API can refuse requests made for another account. */
export function sessionHeaders(path: string): Record<string, string> {
  // /auth/* must always answer for whoever is signed in now (that is how the change is discovered).
  if (!tabAccount || path.startsWith('/auth/')) return {};
  return { [EXPECTED_USER_HEADER]: tabAccount.id };
}

type Message = { type: 'signed-in'; account: Account } | { type: 'signed-out' };

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (channel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<Message>) => {
    const msg = e.data;
    if (!msg || !tabAccount) return;
    if (msg.type === 'signed-out') flag(null);
    else if (msg.type === 'signed-in' && msg.account.id !== tabAccount.id) flag(pick(msg.account));
  };
  return channel;
}

function broadcast(msg: Message) {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // Broadcasting is a courtesy; the API header check is the guarantee.
  }
}

/** Start listening for sign-ins and sign-outs in other tabs (call once on the client). */
export function listenForOtherTabs(): void {
  getChannel();
}

/** Test hook. */
export function resetSessionGuard(): void {
  tabAccount = null;
  change = null;
}
