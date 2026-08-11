/**
 * Ponto de entrada da camada de WhatsApp do CRM.
 *
 * As rotas/serviços usam `getProvider(connection)` e falam com a interface
 * WhatsAppProvider — sem saber se por trás é Evolution, Z-API, Meta, etc.
 */
import { EvolutionProvider } from './providers/evolution';
import { MetaCloudProvider } from './providers/metaCloud';
import type { WhatsAppProvider, ProviderConfig } from './providers/types';

export * from './providers/types';
export { jidToE164 } from './providers/evolution';

/** Forma mínima de uma linha de `wa_connections` necessária p/ montar o provider. */
export interface ConnectionLike {
  provider?: string | null;
  instance_name: string;
  instance_token?: string | null;
  base_url?: string | null;
  /** Só meta_cloud: phone_number_id da Meta. */
  meta_phone_number_id?: string | null;
}

/**
 * Remove sujeira invisível de valores de env colados via CLI/painel: BOM
 * (U+FEFF — já quebrou o header apikey em produção), aspas e espaços.
 */
function cleanEnv(v?: string): string {
  return (v ?? '')
    .replace(/^﻿/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

/** Base URL e token globais (fallback) vindos do ambiente do servidor. */
export function envEvolution(): { baseUrl: string; token: string } {
  return {
    baseUrl: cleanEnv(process.env.EVOLUTION_BASE_URL),
    token: cleanEnv(process.env.EVOLUTION_API_KEY),
  };
}

/**
 * Monta o provider a partir de uma conexão da org. O token/base_url da conexão
 * têm prioridade; se ausentes, usa o global do ambiente (instância compartilhada).
 */
export function getProvider(conn: ConnectionLike): WhatsAppProvider {
  const env = envEvolution();
  const config: ProviderConfig = {
    baseUrl: conn.base_url || env.baseUrl,
    instanceName: conn.instance_name,
    token: conn.instance_token || env.token,
    phoneNumberId: conn.meta_phone_number_id ?? null,
  };
  const provider = (conn.provider || 'evolution').toLowerCase();
  switch (provider) {
    // Cloud API DIRETO na Meta (graph.facebook.com), sem Evolution.
    case 'meta_cloud':
      return new MetaCloudProvider(config);
    // API oficial da Meta via Evolution (integration WHATSAPP-BUSINESS):
    // MESMOS endpoints de envio/estado/webhook — o adapter é idêntico.
    case 'evolution_business':
    case 'evolution':
    default:
      return new EvolutionProvider(config);
  }
}

/** True quando a conexão fala DIRETO com a Cloud API da Meta (sem Evolution). */
export function isMetaCloudConnection(conn: Pick<ConnectionLike, 'provider'>): boolean {
  return (conn.provider || '').toLowerCase() === 'meta_cloud';
}

/** True quando a conexão é do modo API oficial da Meta via Evolution. */
export function isEvolutionBusinessConnection(conn: Pick<ConnectionLike, 'provider'>): boolean {
  return (conn.provider || '').toLowerCase() === 'evolution_business';
}

/**
 * True quando a conexão é "API oficial da Meta" em QUALQUER backend (via
 * Evolution OU direto). Usar nos pontos que só querem saber "não é QR/Baileys"
 * (bloquear QR, liberar aba de templates, etc.). Para decisões específicas de
 * Evolution (apagar instância), use isEvolutionBusinessConnection.
 */
export function isBusinessConnection(conn: Pick<ConnectionLike, 'provider'>): boolean {
  const p = (conn.provider || '').toLowerCase();
  return p === 'evolution_business' || p === 'meta_cloud';
}
