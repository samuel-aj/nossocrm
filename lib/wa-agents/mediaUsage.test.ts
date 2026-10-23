// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertUsageHealthy, runWithUsageContext } from '@/lib/ai-usage/context';
import type { UsageContext } from '@/lib/ai-usage/types';
import { understandMedia, type MediaMessageRow } from './mediaIn';
import type { AgentRow } from './types';

const h = vi.hoisted(() => ({ reserve: vi.fn(), dispatch: vi.fn(), settle: vi.fn(), block: vi.fn(), transcribe: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/ai-usage/budget', () => ({ reserveUsage: h.reserve, dispatchUsage: h.dispatch, settleUsage: h.settle, blockConversationBudget: h.block }));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), experimental_transcribe: h.transcribe }));
vi.mock('@/lib/ai/config', () => ({ getModel: () => ({ specificationVersion: 'v3', provider: 'fake', modelId: 'gpt-4.1-mini', supportedUrls: {}, doGenerate: h.generate, doStream: vi.fn() }) }));

const org = 'org-fixture';
function fixture(bytes: Uint8Array) {
  const chain = { update: vi.fn(), eq: vi.fn() }; chain.update.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const admin = { storage: { from: () => ({ download: async () => ({ data: new Blob([Uint8Array.from(bytes)]), error: null }) }) }, from: () => chain } as unknown as SupabaseClient;
  const usage: UsageContext = { admin, organizationId: org, accountId: 'account', conversationId: 'conv', agentId: 'agent', runId: null, dealId: null, scope: 'conversation', policyEnabled: true };
  return { admin, usage, chain };
}
function agent(provider: 'openai' | 'google' = 'openai'): AgentRow {
  return { id: 'agent', organization_id: org, provider, model: provider === 'google' ? 'gemini-2.5-flash' : 'gpt-4.1-mini', api_key: 'fake-secret-never-log', audio_api_key: null, media_understanding: { audio: true, image: true, document: true } } as AgentRow;
}
function message(kind: string): MediaMessageRow { return { id: 'msg', media_type: kind, media_url: 'fake-file', media_mime: kind === 'audio' ? 'audio/wav' : 'image/png', body: 'fictitious private caption', transcription: null } as MediaMessageRow; }
function wav(): Buffer {
  const data = Buffer.alloc(44 + 32000); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(32000, 40); return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  h.reserve.mockResolvedValue({ allowed: true, replay: false, attempt_id: 'attempt' }); h.dispatch.mockResolvedValue(true); h.settle.mockResolvedValue(undefined); h.block.mockResolvedValue(undefined);
  h.transcribe.mockResolvedValue({ text: 'Texto fictício', durationInSeconds: 1 });
  h.generate.mockResolvedValue({ content: [{ type: 'text', text: 'Descrição fictícia' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 200, noCache: 200, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }, warnings: [] });
});

describe('media goes through the same budget before payment', () => {
  it('meters a WAV transcription in seconds and disables SDK retries', async () => {
    const f = fixture(wav());
    const rows = await runWithUsageContext(f.usage, () => understandMedia(f.admin, { organizationId: org, agent: agent(), messages: [message('audio')] }));
    expect(rows[0].transcription).toBe('Texto fictício');
    expect(h.reserve.mock.calls[0][1]).toMatchObject({ operation: 'audio_transcription', unit: 'seconds', reservedAmount: 2 });
    expect(h.transcribe.mock.calls[0][0].maxRetries).toBe(0);
    expect(h.settle.mock.calls[0][2]).toMatchObject({ status: 'completed', actualAmount: 1 });
  });

  it('stops unsupported protected audio without calling the provider or saving a fake transcript', async () => {
    const f = fixture(Buffer.from('unsupported mp3'));
    await runWithUsageContext(f.usage, async () => {
      await understandMedia(f.admin, { organizationId: org, agent: agent(), messages: [message('audio')] });
      expect(() => assertUsageHealthy()).toThrow('reserva');
    });
    expect(h.transcribe).not.toHaveBeenCalled(); expect(h.reserve).not.toHaveBeenCalled(); expect(f.chain.update).not.toHaveBeenCalled(); expect(h.block).toHaveBeenCalled();
  });

  it('reserves Google audio as tokens from locally bounded frame duration', async () => {
    const f = fixture(wav());
    await runWithUsageContext(f.usage, () => understandMedia(f.admin, { organizationId: org, agent: agent('google'), messages: [message('audio')] }));
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.reserve.mock.calls[0][1]).toMatchObject({ operation: 'audio_understanding', provider: 'google', unit: 'tokens' });
    expect(h.settle.mock.calls[0][2]).toMatchObject({ actualAmount: 220 });
  });

  it('meters an image and stores only numeric metadata, never its caption or key', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
    const f = fixture(png);
    await runWithUsageContext(f.usage, () => understandMedia(f.admin, { organizationId: org, agent: agent(), messages: [message('image')] }));
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.reserve.mock.calls[0][1].operation).toBe('image_understanding');
    const recorded = JSON.stringify([h.reserve.mock.calls.map(call => call[1]), h.settle.mock.calls.map(call => call[2])]);
    expect(recorded).not.toContain('private caption'); expect(recorded).not.toContain('fake-secret');
  });

  it('a media quota denial remains sticky despite the media error fallback', async () => {
    const f = fixture(wav()); h.reserve.mockResolvedValueOnce({ allowed: false, replay: false, reason: 'limit' });
    await runWithUsageContext(f.usage, async () => {
      await understandMedia(f.admin, { organizationId: org, agent: agent(), messages: [message('audio')] });
      expect(() => assertUsageHealthy()).toThrow('limit');
    });
    expect(h.transcribe).not.toHaveBeenCalled();
  });
});
