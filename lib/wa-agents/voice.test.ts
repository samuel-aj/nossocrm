import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentInputSchema, type AgentRow } from './types';
import { readVoiceScript, wrapVoiceSelection } from './voiceScript';
import { prepareReplyOutput } from './replyOutput';
import { voiceDelivery } from './voiceDelivery';
import { prepareVoiceFile, synthesizeVoice, verifiedAudio } from './voice';

const meter = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai-usage/context', () => ({ requireUsageContext: () => ({ organizationId: 'office' }) }));
vi.mock('@/lib/ai-usage/meteredModel', () => ({ meteredOperation: meter, textInputBound: () => 2048 }));
const phrase = 'Vou te mandar o link por aqui.';
const link = 'https://assinatura.invalid/123';
const approved = { kind: 'text' as const, text: phrase, voice: true as const };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('roteiro e distribuição de voz', () => {
  it('marca só a seleção e mantém a numeração no roteiro', () => {
    const source = 'Antes ' + phrase + ' Depois';
    const marked = wrapVoiceSelection(source, 6, 6 + phrase.length);
    expect(marked.value).toBe('Antes [audio]' + phrase + '[/audio] Depois');
    const script = readVoiceScript(marked.value + ' [audio]Até mais.[/audio]');
    expect(script).toMatchObject({ clips: [phrase, 'Até mais.'], error: '' });
    expect(script.prompt).toContain('falar_trecho com trecho 2');
    expect(script.prompt).not.toContain('[audio]');
    expect(readVoiceScript(marked.value, true).prompt).toBe(source);
  });
  it.each(['[audio]a', 'x[/audio]', '[audio] [/audio]', '[audio][audio]a[/audio][/audio]', '[audio]' + link + '[/audio]'])(
    'rejeita marcação inválida no cadastro e no rascunho do simulador: %s', script => {
      expect(AgentInputSchema.partial().safeParse({ system_prompt: script }).success).toBe(false);
    });
  it('aceita os cadastros antigos e conserva o formato escrito por padrão', () => {
    expect(AgentInputSchema.partial().parse({ media_understanding: { audio: true } }).media_understanding?.reply_to_audio).toBeFalsy();
    expect(voiceDelivery([{ kind: 'text', text: phrase }], false)).toEqual([{ kind: 'text', text: phrase }]);
  });
  it('separa a fala automática e o link na ordem em que aparecem', () => {
    expect(voiceDelivery([{ kind: 'text', text: phrase + ' ' + link }], true)).toEqual([approved, { kind: 'text', text: link }]);
  });
  it('o mesmo trecho solicitado ou ecoado duas vezes é enviado uma só vez', () => {
    const ordered = prepareReplyOutput([approved, approved, { kind: 'text', text: phrase + ' ' + link }]);
    expect(voiceDelivery(ordered.segments, true)).toEqual([approved, expect.objectContaining({ kind: 'text', text: link })]);
  });
  it('bloqueia comandos de voz que o modelo escreveu como resposta', () => {
    expect(prepareReplyOutput([{ kind: 'text', text: 'falar_trecho(1)' }]).segments).toEqual([]);
  });
});

describe('síntese com provedor simulado', () => {
  const audio = (text: string) => ({
    choices: [{ finish_reason: 'stop', message: { audio: { data: 'SUQz', transcript: text } } }],
    usage: { total_tokens: 21, prompt_tokens: 8, completion_tokens: 13 },
  });
  it('descarta gravações cortadas ou que alteram a frase aprovada', () => {
    expect(verifiedAudio(audio('Já enviei o link.'), phrase)).toBeNull();
    expect(verifiedAudio({ choices: [{ ...audio(phrase).choices[0], finish_reason: 'length' }] }, phrase)).toBeNull();
  });
  it.each([[undefined, 'alloy'], ['coral', 'coral']] as const)('gera a prévia em memória com a voz %s', async (voice, expectedVoice) => {
    const fetchAudio = vi.fn().mockResolvedValue(Response.json(audio(phrase)));
    vi.stubGlobal('fetch', fetchAudio);
    meter.mockImplementation(opts => opts.execute());
    const agent = { organization_id: 'office', audio_api_key: 'teste', media_understanding: { voice } } as AgentRow;
    const preview = await synthesizeVoice({} as SupabaseClient, agent, phrase);
    expect(preview.bytes?.toString('base64')).toBe('SUQz');
    expect(fetchAudio.mock.calls.map(([url]) => url)).toEqual(['https://api.openai.com/v1/chat/completions']);
    expect(JSON.parse(fetchAudio.mock.calls[0][1].body).audio).toEqual({ voice: expectedVoice, format: 'mp3' });
  });
  it('mede o consumo e só grava o áudio verificado no espaço do escritório', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const db = { storage: { from: vi.fn(() => ({ upload })) } } as unknown as SupabaseClient;
    const agent = { provider: 'google', organization_id: 'office', audio_api_key: 'teste', media_understanding: { voice: 'cedar' } } as AgentRow;
    const request = vi.fn().mockResolvedValue(Response.json(audio(phrase)));
    vi.stubGlobal('fetch', request);
    meter.mockImplementation(async opts => {
      const result = await opts.execute();
      expect(opts.usage(result)).toMatchObject({ totalTokens: 21 });
      return result;
    });
    const file = await prepareVoiceFile(db, agent, phrase);
    expect(file.path).toMatch(/^office\/out\/.+_voz\.mp3$/);
    expect(upload).toHaveBeenCalledOnce();
    expect(JSON.parse(request.mock.calls[0][1].body).audio.voice).toBe('cedar');
    expect(JSON.parse(request.mock.calls[0][1].body).messages.at(-1).content).toBe(phrase);
    expect(meter).toHaveBeenCalledWith(expect.objectContaining({ operation: 'voice_reply' }));
  });
  it('impede síntese quando a reserva de tokens falha', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    meter.mockRejectedValue(new Error('limite atingido'));
    await expect(prepareVoiceFile({} as SupabaseClient, { organization_id: 'office', audio_api_key: 'teste' } as AgentRow, phrase)).rejects.toThrow('limite atingido');
    expect(request).not.toHaveBeenCalled();
  });
});
