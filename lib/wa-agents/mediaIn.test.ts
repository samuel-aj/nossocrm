import { describe, expect, it } from 'vitest';
import { mediaSummaryText, planAudio } from './mediaIn';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentProvider, AgentRow } from './types';

const ORG = '11111111-1111-1111-1111-111111111111';

/** organization_settings com (ou sem) a chave da OpenAI da organização. */
function fakeAdmin(openaiKey: string): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { ai_openai_key: openaiKey } }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function agente(provider: AgentProvider, audioKey: string | null): AgentRow {
  return { provider, model: 'x', api_key: null, audio_api_key: audioKey } as unknown as AgentRow;
}

/**
 * O texto gravado em `transcription` SUBSTITUI o marcador ("[áudio]", "[imagem]")
 * no histórico do agente: ele precisa dizer sozinho que veio de uma mídia, senão
 * o modelo perde a informação de que o lead mandou um arquivo.
 */
describe('mediaSummaryText', () => {
  it('áudio vira só a fala transcrita', () => {
    expect(mediaSummaryText('audio', 'Oi, meu carro foi apreendido ontem.', 'audio.ogg', '')).toBe(
      'Oi, meu carro foi apreendido ontem.'
    );
  });

  it('imagem se identifica e carrega a legenda do lead', () => {
    const t = mediaSummaryText('image', 'Print de um boleto do banco Safra, parcela de R$ 2.999.', 'foto.jpg', 'olha aí');
    expect(t.startsWith('[imagem] ')).toBe(true);
    expect(t).toContain('Safra');
    expect(t).toContain('Legenda do lead: "olha aí"');
  });

  it('figurinha é curta e não repete legenda (figurinha não tem)', () => {
    const t = mediaSummaryText('sticker', 'Um gato com os olhos brilhando, agradecendo.', '', 'ignorada');
    expect(t).toBe('[figurinha] Um gato com os olhos brilhando, agradecendo.');
  });

  it('documento mostra o nome do arquivo quando existe', () => {
    expect(mediaSummaryText('document', 'CONTRATO DE FINANCIAMENTO...', 'contrato.pdf', '')).toBe(
      '[documento: contrato.pdf] CONTRATO DE FINANCIAMENTO...'
    );
    expect(mediaSummaryText('document', 'texto', '', '')).toBe('[documento] texto');
  });
});

/**
 * Quem transcreve o áudio. A chave dedicada existe justamente para o provedor
 * que não ouve (Anthropic): sem nenhuma chave da OpenAI, o áudio não vira texto.
 */
describe('planAudio', () => {
  const orgComChave = fakeAdmin('org-openai');
  const orgSemChave = fakeAdmin('');

  it('chave dedicada do agente ganha do provedor', async () => {
    const plano = await planAudio(orgComChave, ORG, agente('anthropic', 'propria'), 'chave-anthropic');
    expect(plano).toEqual({ via: 'whisper', key: 'propria' });
  });

  it('agente OpenAI sem chave dedicada usa a própria chave no whisper', async () => {
    expect(await planAudio(orgSemChave, ORG, agente('openai', null), 'chave-openai')).toEqual({
      via: 'whisper',
      key: 'chave-openai',
    });
  });

  it('agente Google ouve o arquivo com o próprio modelo', async () => {
    expect(await planAudio(orgSemChave, ORG, agente('google', null), 'chave-google')).toEqual({
      via: 'provider',
      key: 'chave-google',
    });
  });

  it('agente Anthropic cai na chave da OpenAI da organização', async () => {
    expect(await planAudio(orgComChave, ORG, agente('anthropic', null), 'chave-anthropic')).toEqual({
      via: 'whisper',
      key: 'org-openai',
    });
  });

  it('agente Anthropic sem nenhuma chave da OpenAI não transcreve', async () => {
    expect(await planAudio(orgSemChave, ORG, agente('anthropic', null), 'chave-anthropic')).toBeNull();
  });
});
