/**
 * Ponto de entrada da camada de WhatsApp do CRM.
 *
 * As rotas/serviços usam `getProvider(connection)` e falam com a interface
 * WhatsAppProvider — sem saber se por trás é Evolution, Z-API, Meta, etc.
 */
import { EvolutionProvider } from './providers/evolution';
import type { WhatsAppProvider, ProviderConfig } from './providers/types';

export * from './providers/types';
export { jidToE164 } from './providers/evolution';

/** Forma mínima de uma linha de `wa_connections` necessária p/ montar o provider. */
export interface ConnectionLike {
  provider?: string | null;
  instance_name: string;
  instance_token?: string | null;
  base_url?: string | null;
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
  };
  const provider = (conn.provider || 'evolution').toLowerCase();
  switch (provider) {
    case 'evolution':
    default:
      return new EvolutionProvider(config);
  }
}
