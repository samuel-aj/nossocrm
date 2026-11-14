import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAgentRow } from '@/lib/wa-agents/context';
import { POST } from './route';
import { PATCH } from '../route';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), synthesize: vi.fn(), usage: vi.fn(), from: vi.fn(), chat: vi.fn(),
}));
vi.mock('../../../_shared', async importOriginal => ({
  ...await importOriginal<typeof import('../../../_shared')>(),
  guardRoute: async () => ({ ok: true, user: { organizationId: 'office' }, admin: { from: mocks.from } }),
}));
vi.mock('@/lib/wa-agents/context', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/wa-agents/context')>(), loadAgent: mocks.load,
}));
vi.mock('@/lib/wa-agents/test', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/wa-agents/test')>(), testAgentReply: mocks.chat,
}));
vi.mock('@/lib/wa-agents/voice', () => ({ synthesizeVoice: mocks.synthesize }));
vi.mock('@/lib/ai-usage/budget', () => ({ createUsageContext: mocks.usage }));

const id = '10000000-0000-4000-8000-000000000001';
const saved = normalizeAgentRow({ id, organization_id: 'office', media_understanding: { voice: 'sage', audio: false } });
const audio = { bytes: Buffer.from([1, 2]) };
function preview(agentId: string, voice: string, previewVoice: string | true = true) {
  const body = { previewVoice, draft: { media_understanding: { voice } } };
  return POST(new Request('http://localhost/test', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: agentId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.synthesize.mockResolvedValue(audio);
  mocks.usage.mockResolvedValue({ organizationId: 'office' });
});

describe('escolha da voz de um agente', () => {
  it('preserva comprovantes de mídias simuladas entre respostas', async () => {
    mocks.load.mockResolvedValue(saved);
    mocks.chat.mockResolvedValue({ text: 'Continue', lines: ['Continue'], media: [] });
    const messages = [{ role: 'assistant', text: 'Olá', media: ['boas_vindas'] }, { role: 'user', text: 'Maria' }];
    const response = await POST(new Request('http://localhost/test', { method: 'POST', body: JSON.stringify({ messages }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(mocks.chat.mock.calls[0][1].messages).toEqual(messages);
    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([id, 'new'])('ouve a voz do rascunho sem salvar ou acionar o atendimento (%s)', async agentId => {
    mocks.load.mockResolvedValue(saved);
    const response = await preview(agentId, 'coral');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ audio: audio.bytes.toString('base64') });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.synthesize.mock.calls[0][1].media_understanding.voice).toBe('coral');
    expect(mocks.synthesize.mock.calls[0][2]).toBeNull();
    expect(saved.media_understanding.voice).toBe('sage');
    expect(mocks.load).toHaveBeenCalledTimes(agentId === 'new' ? 0 : 1);
    expect(mocks.usage).toHaveBeenCalledWith(expect.anything(), { organizationId: 'office', agentId: agentId === 'new' ? null : id, scope: 'test' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });
  it('mantém o texto obrigatório na prévia de uma fala do simulador', async () => {
    mocks.load.mockResolvedValue(saved);
    expect((await preview(id, 'sage', 'A proposta vale até sexta.')).status).toBe(200);
    expect(mocks.synthesize.mock.calls[0][2]).toBe('A proposta vale até sexta.');
  });
  it('recusa voz inválida ou agente indisponível no escritório', async () => {
    expect((await preview('new', 'voz-inexistente')).status).toBe(400);
    mocks.load.mockResolvedValue(null);
    expect((await preview(id, 'sage')).status).toBe(404);
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), 'office', id);
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });
  it.each([
    [{ voice: 'coral' }, { voice: 'coral', audio: false }],
    [{ audio: true }, { voice: 'sage', audio: true }],
  ])('salva somente as opções alteradas em mídias (%j)', async (incoming, expected) => {
    const query = {
      select: () => query, eq: () => query,
      update: vi.fn(() => query), maybeSingle: async () => ({ data: saved }),
    };
    mocks.from.mockReturnValue(query);
    const response = await PATCH(new Request('http://localhost/agent', {
      method: 'PATCH', body: JSON.stringify({ media_understanding: incoming }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ media_understanding: expect.objectContaining(expected) }));
  });
});
