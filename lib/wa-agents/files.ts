/**
 * Caminhos e nomes dos arquivos dos agentes no bucket privado wa-agent-files:
 * `${orgId}/agents/${agentId}/docs/<uuid>_<nome>` e `.../media/<uuid>_<nome>`.
 *
 * CLIENT-SAFE: só funções puras.
 */
import type { AgentUploadKind } from './types';

/** Nome seguro para o Storage (ASCII, sem espaços), preservando a extensão. */
export function sanitizeStorageFileName(name: string): string {
  const trimmed = (name || 'arquivo').slice(-120);
  const ascii = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const safe = ascii.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+/, '');
  return safe || 'arquivo';
}

/** Nome original do arquivo a partir do caminho `<uuid>_<nome>` no bucket. */
export function originalFileName(storagePath: string, fallback: string): string {
  const base = (storagePath || '').split('/').pop() ?? '';
  const m = /^[0-9a-f-]{36}_(.+)$/i.exec(base);
  return (m ? m[1] : base) || fallback;
}

/** Pasta dos arquivos de um agente por tipo (termina com "/"). */
export function agentFilePrefix(organizationId: string, agentId: string, kind: AgentUploadKind): string {
  return `${organizationId}/agents/${agentId}/${kind === 'doc' ? 'docs' : 'media'}/`;
}

/** Caminho completo de um arquivo novo (uuid + nome saneado). */
export function agentFilePath(organizationId: string, agentId: string, kind: AgentUploadKind, fileName: string, uuid: string): string {
  return `${agentFilePrefix(organizationId, agentId, kind)}${uuid}_${sanitizeStorageFileName(fileName)}`;
}

/** true quando o caminho está na pasta esperada do agente (sem ".." nem barras duplas). */
export function isAgentFilePath(path: string, organizationId: string, agentId: string, kind: AgentUploadKind): boolean {
  if (!path || path.includes('..') || path.includes('//') || path.startsWith('/')) return false;
  const prefix = agentFilePrefix(organizationId, agentId, kind);
  return path.startsWith(prefix) && path.length > prefix.length;
}
