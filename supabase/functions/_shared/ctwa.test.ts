import { describe, expect, it, vi } from 'vitest';
import { evolutionCtwa, metaCtwa, recordCtwa } from './ctwa';

const reference = { source_type: 'ad', source_id: 'ad-42', ctwa_clid: 'click-1', headline: 'Campanha', source_url: 'https://fb.me/exemplo' };
const expected = { ad_id: 'ad-42', click_id: 'click-1', headline: 'Campanha', source_url: 'https://fb.me/exemplo' };
const ad = { sourceType: 'ad', sourceId: 'ad-42', ctwaClid: 'click-1', title: 'Campanha', sourceUrl: 'https://fb.me/exemplo' };
const msg = { extendedTextMessage: { contextInfo: { externalAdReply: ad } } };
const ctx = { organizationId: 'org', connectionId: 'conn', conversationId: 'conv', messageId: 'msg', timestamp: '2026-11-06T13:00:00Z' };

describe('CTWA informado pelo provedor', () => {
  it('lê a referência direta da Meta, com ou sem identificador do clique', () => {
    expect(metaCtwa({ referral: reference })).toEqual(expected);
    expect(metaCtwa({ referral: { ...reference, ctwa_clid: undefined } })).toEqual({ ...expected, click_id: null });
    expect(metaCtwa({ referral: { ctwa_clid: 'click' } })?.click_id).toBe('click');
    expect(metaCtwa({ referral: { source_type: 'ad', source_url: reference.source_url } })?.source_url).toBe(reference.source_url);
    expect(metaCtwa({ referral: { source_type: 'ad', source_url: 'texto qualquer' } })).toBeNull();
  });
  it.each([{}, { context: { referral: reference } }, { referral: { source_type: 'post', source_id: '1' } },
    { referral: { source_url: 'https://fb.me/link' } }, { referral: { source_type: 'ad', source_id: ' ' } }])(
    'ignora ausência de evidência e referências orgânicas', value => expect(metaCtwa(value)).toBeNull());
  it('lê o contexto direto e a mensagem temporária do QR', () => {
    expect(evolutionCtwa({ message: msg })).toEqual(expected);
    expect(evolutionCtwa({ message: { ephemeralMessage: { message: msg } } })).toEqual(expected);
    expect(evolutionCtwa({ contextInfo: { externalAdReply: ad } })).toEqual(expected);
  });
  it('extrai as UTMs fornecidas, decodifica o link e ignora outros parâmetros', () => {
    const url = reference.source_url + '?utm_campaign=BPC+Sul&utm_medium=cpc&utm_term=a%26b&utm_content=&token=private';
    expect(metaCtwa({referral:{...reference,utm_source:'instagram',source_url:url}})?.utms)
      .toEqual({utm_source:'instagram',utm_campaign:'BPC Sul',utm_medium:'cpc',utm_term:'a&b'});
    expect(evolutionCtwa({contextInfo:{utm:{utmSource:'facebook',utmCampaign:'Da campanha'},externalAdReply:{...ad,sourceUrl:url}}})?.utms)
      .toEqual({utm_source:'facebook',utm_campaign:'Da campanha',utm_medium:'cpc',utm_term:'a&b'});
    expect(metaCtwa({referral:{source_type:'post',source_url:url}})).toBeNull();
  });
  it('ignora anúncios citados, encaminhados e prévias genéricas no QR', () => {
    const qr = (contextInfo: unknown) => evolutionCtwa({ message: { imageMessage: { contextInfo } } });
    expect(qr({ quotedMessage: msg })).toBeNull();
    expect(qr({ externalAdReply: ad, isForwarded: true })).toBeNull();
    expect(qr({ externalAdReply: { title: 'Link', sourceUrl: ad.sourceUrl } })).toBeNull();
    expect(qr({ externalAdReply: { ...ad, sourceType: 'post' } })).toBeNull();
  });
  it('grava só referência validada na conversa e conexão de origem', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    expect(await recordCtwa({ rpc }, ctx, 'meta', null)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(await recordCtwa({ rpc }, ctx, 'meta', expected)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_wa_ctwa', {
      p_org:'org', p_connection:'conn', p_conv:'conv', p_message:'msg', p_time:ctx.timestamp, p_provider:'meta', p_ref:expected,
    });
  });
  it('permite reentrega quando a gravação da origem falha', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await recordCtwa({ rpc:vi.fn().mockResolvedValue({ error:{ message:'unavailable' } }) }, ctx, 'evolution', expected)).toBe(false);
    } finally { log.mockRestore(); }
  });
});
