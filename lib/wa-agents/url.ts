/**
 * URL de webhook: só http/https para um host público (mitigação de SSRF).
 * Rejeita localhost, redes privadas e endereços de link-local/loopback.
 *
 * CLIENT-SAFE: só `URL`; usado pelos esquemas zod e pelo POST dos webhooks.
 */

/** IPv4 em quatro octetos decimais; o parser da URL já normaliza formas como 0x7f.1 ou 2130706433. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(p => Number(p));
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 0.*, 10.*, 127.*
  if (a === 169 && b === 254) return true; // 169.254.* (link-local, metadados de nuvem)
  if (a === 192 && b === 168) return true; // 192.168.*
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.* a 172.31.*
  return false;
}

/** IPv6 já sem colchetes, em minúsculas. */
function isPrivateIpv6(host: string): boolean {
  if (host === '::1' || host === '::') return true; // loopback e não especificado
  if (host.startsWith('::ffff:')) return true; // IPv4 mapeado (o parser guarda em hexa: ::ffff:7f00:1)
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 (rede local única)
  if (host.startsWith('fe80')) return true; // fe80::/10 (link-local)
  return false;
}

/** true quando a URL é http/https e aponta para um host público. */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (host.includes(':')) return !isPrivateIpv6(host);
  if (/^[0-9.]+$/.test(host)) return !isPrivateIpv4(host);
  return true;
}
