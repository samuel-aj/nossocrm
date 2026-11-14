import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beginMediaCooldownDispatch, claimMediaCooldown, finishMediaCooldownDispatch, MediaCooldownError, releaseMediaCooldown } from './mediaCooldown';

function fixture() {
  let now = 0;
  const rows = new Map<string, { attempt: string; until: number }>();
  const key = (a: Record<string, string>) => [a.p_org, a.p_conversation, a.p_media_key].join(':');
  const rpc = vi.fn(async (name: string, args: Record<string, string>) => {
    const id = key(args); const row = rows.get(id);
    if (name === 'touch_wa_media_cooldown' || name === 'finish_wa_media_cooldown') {
      if (row?.attempt !== args.p_attempt) return { data: false, error: null };
      row.until = now + (name === 'touch_wa_media_cooldown' ? 300000 : 60000); return { data: true, error: null };
    }
    if (row && row.until > now) return { data: [{ acquired: false, retry_after_seconds: Math.ceil((row.until - now) / 1000) }], error: null };
    rows.set(id, { attempt: args.p_attempt, until: now + 60000 });
    return { data: [{ acquired: true, retry_after_seconds: 60 }], error: null };
  });
  const db = { rpc, from: () => {
    const filters: Record<string, string> = {};
    const q = { delete: () => q, eq: (k: string, v: string) => { filters[k] = v; return q; }, then: (resolve: (v: unknown) => unknown) => {
      const id = [filters.organization_id, filters.conversation_id, filters.media_key].join(':');
      if (rows.get(id)?.attempt === filters.attempt_id) rows.delete(id);
      return Promise.resolve(resolve({ error: null }));
    } }; return q;
  } } as unknown as SupabaseClient;
  return { db, rpc, advance: (ms: number) => { now += ms; } };
}
const scope = { organizationId: 'org', conversationId: 'conversation', mediaPath: 'org/out/hello.mp4' };

describe('rolling media transport cooldown', () => {
  it('allows one concurrent owner and rejects the others without sharing customers or files', async () => {
    const f = fixture();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => claimMediaCooldown(f.db, scope)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(4);
    await expect(claimMediaCooldown(f.db, { ...scope, conversationId: 'another' })).resolves.toBeDefined();
    await expect(claimMediaCooldown(f.db, { ...scope, mediaPath: 'org/out/other.mp4' })).resolves.toBeDefined();
    await expect(claimMediaCooldown(f.db, { ...scope, organizationId: 'other', mediaPath: 'other/out/hello.mp4' })).resolves.toBeDefined();
  });
  it('blocks at 59 seconds, permits at 60, and starts a fresh rolling window', async () => {
    const f = fixture(); await claimMediaCooldown(f.db, scope); f.advance(59000);
    await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ code: 'MEDIA_COOLDOWN', retryAfter: 1 });
    f.advance(1000); await expect(claimMediaCooldown(f.db, scope)).resolves.toBeDefined();
    await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ retryAfter: 60 });
  });
  it('holds ownership across slow hooks and starts 60 seconds only after an acknowledgement', async () => {
    const f = fixture(); const receipt = await claimMediaCooldown(f.db, scope); f.advance(59000);
    await beginMediaCooldownDispatch(f.db, receipt); f.advance(61000);
    await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ retryAfter: 239 });
    await finishMediaCooldownDispatch(f.db, receipt, { ok: true });
    await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ retryAfter: 60 });
    f.advance(59000); await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ retryAfter: 1 });
    f.advance(1000); await expect(claimMediaCooldown(f.db, scope)).resolves.toBeDefined();
  });
  it('keeps the dispatch lease on unknown outcomes and failed finalization without falsifying the result', async () => {
    const f = fixture(); const receipt = await claimMediaCooldown(f.db, scope); await beginMediaCooldownDispatch(f.db, receipt);
    await finishMediaCooldownDispatch(f.db, receipt, { ok: false, error: 'timeout' });
    await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ retryAfter: 300 });
    f.rpc.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(finishMediaCooldownDispatch(f.db, receipt, { ok: true })).resolves.toBeUndefined();
    await expect(claimMediaCooldown(f.db, scope)).rejects.toMatchObject({ retryAfter: 300 });
  });
  it('releases a pre-dispatch failure but never deletes a newer attempt', async () => {
    const f = fixture(); const first = await claimMediaCooldown(f.db, scope);
    await releaseMediaCooldown(f.db, first); const second = await claimMediaCooldown(f.db, scope);
    expect(second.attemptId).not.toBe(first.attemptId);
    await releaseMediaCooldown(f.db, first);
    await expect(claimMediaCooldown(f.db, scope)).rejects.toBeInstanceOf(MediaCooldownError);
    f.advance(60000); await claimMediaCooldown(f.db, scope);
    await expect(beginMediaCooldownDispatch(f.db, second)).rejects.toBeInstanceOf(MediaCooldownError);
  });
  it('fails closed on reservation or refresh DB errors', async () => {
    const f = fixture(); f.rpc.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(claimMediaCooldown(f.db, scope)).rejects.toThrow('DB unavailable');
    const receipt = await claimMediaCooldown(f.db, scope);
    f.rpc.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(beginMediaCooldownDispatch(f.db, receipt)).rejects.toThrow('DB unavailable');
  });
  it.each(['other/out/hello.mp4', 'https://storage.test/hello.mp4?token=x', 'org/out/hello.mp4?token=x', 'org/out/../hello.mp4'])('rejects noncanonical file identity: %s', async mediaPath => {
    const f = fixture(); await expect(claimMediaCooldown(f.db, { ...scope, mediaPath })).rejects.toThrow('Caminho');
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
