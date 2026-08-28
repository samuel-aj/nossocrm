/**
 * Catálogo de modelos, rótulos dos provedores e variáveis do roteiro.
 *
 * CLIENT-SAFE: só constantes.
 */
import type { AgentProvider } from './types';

export type ModelCatalogEntry = { id: string; name: string; hint: string };

export const MODEL_CATALOG: Record<AgentProvider, ModelCatalogEntry[]> = {
  openai: [
    { id: 'gpt-4.1', name: 'GPT-4.1', hint: 'Bom equilíbrio entre qualidade e custo' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', hint: 'Rápido e barato, ideal para triagem' },
    { id: 'gpt-4o', name: 'GPT-4o', hint: 'Geração anterior, ainda muito capaz' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', hint: 'Mais barato da linha 4o' },
    { id: 'gpt-5-mini', name: 'GPT-5 mini', hint: 'Nova geração, custo reduzido' },
    { id: 'gpt-5.2', name: 'GPT-5.2', hint: 'Mais capaz da OpenAI, custo maior' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', hint: 'Ótimo em conversas naturais e instruções longas' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', hint: 'Rápido e barato' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', hint: 'Mais capaz da Anthropic, custo maior' },
  ],
  google: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', hint: 'Rápido, barato e com boa qualidade' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', hint: 'O mais barato do Google' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', hint: 'Mais capaz do Google' },
  ],
};

export const PROVIDER_LABELS: Record<AgentProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
};

export type PromptVariableKey =
  | '{{nome_lead}}'
  | '{{primeiro_nome}}'
  | '{{telefone}}'
  | '{{data_hora}}'
  | '{{nome_agente}}'
  | '{{nome_escritorio}}'
  | '{{negocio.titulo}}'
  | '{{negocio.etapa}}';

export const PROMPT_VARIABLES: Array<{ key: PromptVariableKey; description: string }> = [
  { key: '{{nome_lead}}', description: 'Nome do contato (ou o nome que aparece no WhatsApp)' },
  { key: '{{primeiro_nome}}', description: 'Primeiro nome do contato' },
  { key: '{{telefone}}', description: 'Telefone do contato no formato internacional' },
  { key: '{{data_hora}}', description: 'Data e hora atuais em Brasília (ex.: terça-feira, 25 de agosto de 2026 às 15:57)' },
  { key: '{{nome_agente}}', description: 'Nome da persona do agente (ou o nome do agente)' },
  { key: '{{nome_escritorio}}', description: 'Nome da organização' },
  { key: '{{negocio.titulo}}', description: 'Título do negócio ligado à conversa (vazio se não houver)' },
  { key: '{{negocio.etapa}}', description: 'Etapa atual do negócio (vazio se não houver)' },
];

/** Nome da variável sem as chaves duplas: '{{nome_lead}}' -> 'nome_lead'. */
export function promptVariableName(key: string): string {
  return key.replace(/[{}]/g, '').trim();
}

/** Só os nomes das variáveis (o editor usa para saber o que é variável de verdade no texto). */
export const PROMPT_VARIABLE_NAMES: string[] = PROMPT_VARIABLES.map(v => promptVariableName(v.key));
