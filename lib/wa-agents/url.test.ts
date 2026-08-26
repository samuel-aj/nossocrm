import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl } from './url';

describe('isPublicHttpUrl', () => {
  it('aceita http/https para hosts públicos', () => {
    expect(isPublicHttpUrl('https://exemplo.com/hook')).toBe(true);
    expect(isPublicHttpUrl('http://api.exemplo.com.br:8080/x?y=1')).toBe(true);
    expect(isPublicHttpUrl('https://8.8.8.8/hook')).toBe(true);
    expect(isPublicHttpUrl('  https://exemplo.com  ')).toBe(true);
  });

  it('rejeita protocolos que não sejam http/https e texto inválido', () => {
    expect(isPublicHttpUrl('ftp://exemplo.com/x')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpUrl('não é url')).toBe(false);
    expect(isPublicHttpUrl('')).toBe(false);
    expect(isPublicHttpUrl(undefined as unknown as string)).toBe(false);
  });

  it('rejeita localhost e domínios internos', () => {
    expect(isPublicHttpUrl('http://localhost:3000/hook')).toBe(false);
    expect(isPublicHttpUrl('http://app.localhost/hook')).toBe(false);
    expect(isPublicHttpUrl('http://LOCALHOST/hook')).toBe(false);
    expect(isPublicHttpUrl('http://metadata.google.internal/')).toBe(false);
  });

  it('rejeita IPv4 privados, loopback e link-local (inclusive em formas alternativas)', () => {
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://127.1.2.3/')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.5/')).toBe(false);
    expect(isPublicHttpUrl('http://0.0.0.0/')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://172.31.255.255/')).toBe(false);
    expect(isPublicHttpUrl('http://172.32.0.1/')).toBe(true);
    // o parser da URL normaliza 2130706433 e 0x7f000001 para 127.0.0.1
    expect(isPublicHttpUrl('http://2130706433/')).toBe(false);
    expect(isPublicHttpUrl('http://0x7f000001/')).toBe(false);
  });

  it('rejeita IPv6 de loopback, privados, link-local e IPv4 mapeado', () => {
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[::]/')).toBe(false);
    expect(isPublicHttpUrl('http://[fc00::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[fd12:3456::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[fe80::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[2001:4860:4860::8888]/')).toBe(true);
  });
});
