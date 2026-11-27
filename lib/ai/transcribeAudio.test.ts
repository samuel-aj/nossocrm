import { describe, expect, it, vi } from 'vitest';

// O marcador 'server-only' lança fora do Next; a suíte do MCP faz o mesmo em test/mcp.setup.ts.
vi.mock('server-only', () => ({}));
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: ' texto do gemini ' })),
  experimental_transcribe: vi.fn(async () => ({ text: ' texto do whisper ' })),
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => ({ transcription: () => 'whisper-model' }) }));
vi.mock('@/lib/ai/config', () => ({ getModel: () => 'gemini-model' }));

import { transcribeAudio } from './transcribeAudio';

function admin(settings: Record<string, unknown> | null) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: settings }) }) }) }),
  } as never;
}
const bytes = new Uint8Array([1, 2, 3]).buffer;

describe('transcribeAudio', () => {
  it('usa o Gemini quando o escritório usa Google', async () => {
    const r = await transcribeAudio({ admin: admin({ ai_provider: 'google', ai_google_key: 'k' }), organizationId: 'o', bytes, mime: 'audio/mpeg' });
    expect(r).toEqual({ ok: true, text: 'texto do gemini' });
  });
  it('usa o Whisper quando o escritório usa OpenAI', async () => {
    const r = await transcribeAudio({ admin: admin({ ai_provider: 'openai', ai_openai_key: 'k' }), organizationId: 'o', bytes, mime: 'audio/mpeg' });
    expect(r).toEqual({ ok: true, text: 'texto do whisper' });
  });
  it('avisa quando falta a chave', async () => {
    const r = await transcribeAudio({ admin: admin({ ai_provider: 'google' }), organizationId: 'o', bytes, mime: 'audio/mpeg' });
    expect(r.ok).toBe(false);
  });
  it('avisa quando a IA está desligada', async () => {
    const r = await transcribeAudio({ admin: admin({ ai_enabled: false, ai_provider: 'google', ai_google_key: 'k' }), organizationId: 'o', bytes, mime: 'audio/mpeg' });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it('recusa a Anthropic', async () => {
    const r = await transcribeAudio({ admin: admin({ ai_provider: 'anthropic', ai_anthropic_key: 'k' }), organizationId: 'o', bytes, mime: 'audio/mpeg' });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it('recusa áudio vazio ou grande demais', async () => {
    const empty = await transcribeAudio({ admin: admin({ ai_provider: 'google', ai_google_key: 'k' }), organizationId: 'o', bytes: new ArrayBuffer(0), mime: 'audio/mpeg' });
    expect(empty.ok).toBe(false);
    const big = await transcribeAudio({ admin: admin({ ai_provider: 'google', ai_google_key: 'k' }), organizationId: 'o', bytes: new ArrayBuffer(15 * 1024 * 1024), mime: 'audio/mpeg' });
    expect(big.ok).toBe(false);
  });
});
