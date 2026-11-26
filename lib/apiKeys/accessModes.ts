export const AI_AGENT_READ_SCOPE = 'ai_agents:read';
export const AI_AGENT_WRITE_PROMPT_SCOPE = 'ai_agents:write_prompt';

export const API_KEY_ACCESS_MODES = ['full', 'squad_read', 'squad_prompt'] as const;
export type ApiKeyAccessMode = (typeof API_KEY_ACCESS_MODES)[number];

export const ACCESS_MODE_LABELS: Record<ApiKeyAccessMode, string> = {
  full: 'Acesso completo',
  squad_read: 'Squad AgentMaker — leitura',
  squad_prompt: 'Squad AgentMaker — leitura e prompt',
};

export function scopesForAccessMode(mode: ApiKeyAccessMode): string[] | null {
  switch (mode) {
    case 'full': return null;
    case 'squad_read': return [AI_AGENT_READ_SCOPE];
    case 'squad_prompt': return [AI_AGENT_READ_SCOPE, AI_AGENT_WRITE_PROMPT_SCOPE];
  }
}

export function accessLabelForScopes(scopes?: string[] | null): string {
  if (scopes === null) return ACCESS_MODE_LABELS.full;
  if (!Array.isArray(scopes)) return 'Acesso não informado';
  if (scopes.includes(AI_AGENT_READ_SCOPE)) {
    return ACCESS_MODE_LABELS[scopes.includes(AI_AGENT_WRITE_PROMPT_SCOPE) ? 'squad_prompt' : 'squad_read'];
  }
  return 'Acesso restrito';
}
