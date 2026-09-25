import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './AuthContext';
import { pinTabOrg, readTabOrg } from '@/lib/tabOrg';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), getSession: vi.fn(), clear: vi.fn(),
  listener: null as null | ((event: AuthChangeEvent, session: Session | null) => void),
}));
vi.mock('../lib/supabase/client', () => ({ supabase: {
  rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  auth: {
    getSession: mocks.getSession,
    onAuthStateChange: (listener: typeof mocks.listener) => {
      mocks.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
  from: (table: string) => {
    const filters: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { filters[key] = value; return query; },
      abortSignal: () => query,
      single: () => mocks.query(table, filters),
      maybeSingle: () => mocks.query(table, filters),
    };
    return query;
  },
} }));
vi.mock('@/lib/query', () => ({ queryClient: { clear: mocks.clear } }));
vi.mock('@/lib/tabOrgFetch', () => ({ installTabOrgFetch: vi.fn() }));

const session = (id = 'samuel') => ({ user: { id } }) as Session;
const row = (id = 'samuel', role = 'super_admin') => ({
  id, email: `${id}@example.test`, name: id, role,
  organization_id: 'home', organizations: { name: 'Anúncio Jurídico' },
});
const success = (id = 'samuel') => ({ data: row(id), error: null });
let auth: ReturnType<typeof useAuth>;
function Probe() {
  const value = useAuth();
  React.useEffect(() => { auth = value; }, [value]);
  return null;
}
async function emit(event: AuthChangeEvent, value: Session | null) {
  await act(async () => { mocks.listener!(event, value); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.getSession.mockImplementation(() => new Promise(() => {}));
  mocks.query.mockReset().mockResolvedValue(success());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AuthProvider profile recovery', () => {
  it('loads normally from getSession when no initial auth event has arrived', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session() } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await tick(0);
    expect(auth.profile?.name).toBe('samuel');
    expect(auth.loading).toBe(false);
  });

  it('recovers from a temporary profile failure without releasing an incomplete session', async () => {
    mocks.query.mockResolvedValueOnce({ data: null, error: { message: 'network unavailable' } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    expect(auth.loading).toBe(true);
    expect(auth.profile).toBeNull();
    await tick(3000);
    expect(auth.profile?.name).toBe('samuel');
    expect(auth.profile?.role).toBe('super_admin');
    expect(auth.loading).toBe(false);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after persistent failure and supports a manual retry', async () => {
    mocks.query.mockResolvedValue({ data: null, error: { message: 'offline' } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    await tick(4000);
    expect(auth.loading).toBe(false);
    expect(auth.profileError).toBeTruthy();
    expect(auth.profile).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(3);
    mocks.query.mockResolvedValue(success());
    let retry!: Promise<void>;
    await act(async () => { retry = auth.refreshProfile(); });
    await tick(0);
    await act(async () => { await retry; });
    expect(auth.profile?.name).toBe('samuel');
    expect(auth.profileError).toBeNull();
  });

  it('bounds a profile request that never responds', async () => {
    mocks.query.mockImplementation(() => new Promise(() => {}));
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    await tick(30000);
    expect(auth.loading).toBe(false);
    expect(auth.profileError).toBeTruthy();
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it('recovers when the connection returns, without adding focus queries after recovery', async () => {
    mocks.query.mockResolvedValue({ data: null, error: { message: 'offline' } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    await tick(4000);
    mocks.query.mockResolvedValue(success());
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await tick(0);
    expect(auth.profile?.id).toBe('samuel');
    mocks.query.mockClear();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await tick(0);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('loads once when StrictMode remounts effects', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session() } });
    render(<React.StrictMode><AuthProvider><Probe /></AuthProvider></React.StrictMode>);
    await tick(0);
    expect(auth.profile?.id).toBe('samuel');
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent session initialization and ignores a late getSession after logout', async () => {
    let finishSession!: (value: { data: { session: Session } }) => void;
    let finishProfile!: (value: ReturnType<typeof success>) => void;
    mocks.getSession.mockImplementation(() => new Promise(resolve => { finishSession = resolve; }));
    mocks.query.mockImplementation(() => new Promise(resolve => { finishProfile = resolve; }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    await emit('SIGNED_IN', session());
    expect(mocks.query).toHaveBeenCalledTimes(1);
    await emit('SIGNED_OUT', null);
    await act(async () => { finishSession({ data: { session: session() } }); finishProfile(success()); });
    expect(auth.profile).toBeNull();
    expect(auth.user).toBeNull();
    expect(readTabOrg()).toBeNull();
  });

  it('does not apply another user’s late profile or repin their organization', async () => {
    let finishProfile!: (value: ReturnType<typeof success>) => void;
    mocks.query.mockImplementationOnce(() => new Promise(resolve => { finishProfile = resolve; }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    mocks.query.mockResolvedValue(success('other'));
    await emit('SIGNED_IN', session('other'));
    await act(async () => { finishProfile(success()); });
    expect(auth.user?.id).toBe('other');
    expect(auth.profile?.id).toBe('other');
    expect(mocks.clear).toHaveBeenCalled();
  });

  it('keeps the loaded profile and tab organization on a failed token refresh', async () => {
    pinTabOrg('client', 'Cliente');
    mocks.query.mockImplementation(async (table: string) => table === 'profiles'
      ? success() : { data: { name: 'Cliente' }, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    expect(auth.profile?.organization_id).toBe('client');
    mocks.query.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await emit('TOKEN_REFRESHED', session());
    await tick(4000);
    expect(auth.profile?.id).toBe('samuel');
    expect(auth.profile?.organization_id).toBe('client');
    expect(readTabOrg()?.id).toBe('client');
  });

  it('retries membership lookup without losing the tab pin or using the default org role', async () => {
    pinTabOrg('client', 'Cliente');
    let membershipAttempts = 0;
    mocks.query.mockImplementation(async (table: string) => {
      if (table === 'profiles') return { data: row('samuel', 'admin'), error: null };
      if (++membershipAttempts === 1) return { data: null, error: { message: 'offline' } };
      return { data: { role: 'vendedor', organizations: { name: 'Cliente' } }, error: null };
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    expect(auth.profile).toBeNull();
    expect(readTabOrg()?.id).toBe('client');
    await tick(3000);
    expect(auth.profile?.organization_id).toBe('client');
    expect(auth.profile?.role).toBe('vendedor');
  });

  it('returns to the default organization only after confirmed membership removal', async () => {
    pinTabOrg('removed', 'Cliente');
    mocks.query.mockImplementation(async (table: string) => table === 'profiles'
      ? { data: row('samuel', 'vendedor'), error: null } : { data: null, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session());
    expect(auth.profile?.organization_id).toBe('home');
    expect(readTabOrg()?.id).toBe('home');
  });
});
