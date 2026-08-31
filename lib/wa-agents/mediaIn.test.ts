import { describe, expect, it } from 'vitest';
import { mediaSummaryText } from './mediaIn';

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
