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

/**
 * Variáveis do SISTEMA disponíveis nos campos de texto das ações (além das do
 * roteiro). Precisa bater com buildActionSystemVars em lib/wa-agents/actionVars.ts.
 */
export const ACTION_TEXT_VARIABLES: Array<{ key: string; description: string }> = [
  { key: '{{nome_lead}}', description: 'Nome do contato (ou o nome do WhatsApp)' },
  { key: '{{primeiro_nome}}', description: 'Primeiro nome do contato' },
  { key: '{{telefone}}', description: 'Telefone do contato' },
  { key: '{{email}}', description: 'E-mail do contato (vazio se não houver)' },
  { key: '{{empresa}}', description: 'Empresa do contato (vazio se não houver)' },
  { key: '{{data_hora}}', description: 'Data e hora atuais em Brasília' },
  { key: '{{nome_agente}}', description: 'Nome da persona do agente' },
  { key: '{{nome_escritorio}}', description: 'Nome da organização' },
  { key: '{{negocio.titulo}}', description: 'Título do negócio (lead) da conversa' },
  { key: '{{negocio.etapa}}', description: 'Etapa atual do negócio' },
  { key: '{{negocio.quadro}}', description: 'Quadro (pipeline) do negócio' },
  { key: '{{negocio.valor}}', description: 'Valor do negócio' },
  { key: '{{negocio.responsavel}}', description: 'Responsável pelo negócio' },
  { key: '{{resumo}}', description: 'Resumo do atendimento (ou os detalhes da ação)' },
  { key: '{{campos.chave}}', description: 'Campo personalizado do negócio (troque "chave" pela chave do campo)' },
];

/** Nomes das variáveis das ações, sem as chaves (para o destaque no texto). */
export const ACTION_TEXT_VARIABLE_NAMES: string[] = ACTION_TEXT_VARIABLES.map(v => promptVariableName(v.key));

export type VariableOption = { key: string; description: string };
/** Grupo do menu "Inserir variável" (Contato, Lead, Atendimento...). */
export type VariableGroup = { label: string; vars: VariableOption[] };

function pick(keys: string[]): VariableOption[] {
  return keys.map(k => ACTION_TEXT_VARIABLES.find(v => v.key === k)).filter((v): v is VariableOption => !!v);
}

/** As mesmas variáveis dos campos de texto das ações, agrupadas para o menu. */
export const ACTION_TEXT_VARIABLE_GROUPS: VariableGroup[] = [
  { label: 'Contato', vars: pick(['{{nome_lead}}', '{{primeiro_nome}}', '{{telefone}}', '{{email}}', '{{empresa}}']) },
  {
    label: 'Lead',
    vars: pick([
      '{{negocio.titulo}}',
      '{{negocio.etapa}}',
      '{{negocio.quadro}}',
      '{{negocio.valor}}',
      '{{negocio.responsavel}}',
      '{{campos.chave}}',
    ]),
  },
  { label: 'Atendimento', vars: pick(['{{resumo}}', '{{data_hora}}', '{{nome_agente}}', '{{nome_escritorio}}']) },
];

/**
 * Variáveis do CORPO PERSONALIZADO dos webhooks (por evento e ação "Chamar
 * webhook"): caminhos do payload montado em buildWebhookPayload
 * (lib/wa-agents/webhooks.ts) mais os extras de cada evento.
 */
export const WEBHOOK_VARIABLE_GROUPS: VariableGroup[] = [
  {
    label: 'Contato',
    vars: [
      { key: '{{contact.name}}', description: 'Nome' },
      { key: '{{contact.phone}}', description: 'Telefone' },
      { key: '{{contact.email}}', description: 'E-mail' },
      { key: '{{contact.company_name}}', description: 'Empresa' },
    ],
  },
  {
    label: 'Lead',
    vars: [
      { key: '{{deal.id}}', description: 'ID do lead' },
      { key: '{{deal.title}}', description: 'Nome (título) do lead' },
      { key: '{{deal.stage_label}}', description: 'Etapa' },
      { key: '{{deal.board_name}}', description: 'Pipeline (quadro)' },
      { key: '{{deal.owner_name}}', description: 'Responsável' },
      { key: '{{deal.value}}', description: 'Valor' },
      { key: '{{deal.tags}}', description: 'Etiquetas' },
      { key: '{{deal.description}}', description: 'Descrição' },
      { key: '{{deal.custom_fields.chave}}', description: 'Campo personalizado (troque "chave" pela chave do campo)' },
    ],
  },
  {
    label: 'Atendimento',
    vars: [
      { key: '{{conversation.id}}', description: 'ID da conversa' },
      { key: '{{conversation.phone}}', description: 'Número do contato' },
      { key: '{{conversation.name}}', description: 'Nome no WhatsApp' },
      { key: '{{conversation.contact_id}}', description: 'ID do contato' },
      { key: '{{conversation.deal_id}}', description: 'ID do lead da conversa' },
      { key: '{{conversation.ai_status}}', description: 'Situação do agente na conversa' },
      { key: '{{resumo}}', description: 'Resumo do atendimento (no encerramento)' },
      { key: '{{resultado}}', description: 'Chave do resultado (no encerramento)' },
      { key: '{{resultado_label}}', description: 'Nome do resultado (no encerramento)' },
      { key: '{{acao}}', description: 'Chave da ação (em ação durante a conversa)' },
      { key: '{{acao_label}}', description: 'Nome da ação (em ação durante a conversa)' },
      { key: '{{detalhes}}', description: 'Detalhes informados pelo agente (em ação durante a conversa)' },
      { key: '{{text}}', description: 'Texto enviado (em resposta enviada)' },
    ],
  },
  {
    label: 'Agente e evento',
    vars: [
      { key: '{{agent.id}}', description: 'ID do agente' },
      { key: '{{agent.name}}', description: 'Nome do agente' },
      { key: '{{agent.persona_name}}', description: 'Nome da persona' },
      { key: '{{event}}', description: 'Nome do evento' },
      { key: '{{occurred_at}}', description: 'Data e hora (ISO)' },
      { key: '{{organization_id}}', description: 'ID da organização' },
    ],
  },
];

/**
 * Grupos com os campos personalizados da organização listados no grupo "Lead",
 * logo depois do genérico ("chave"). `token(chave)` monta a variável do campo.
 */
export function withCustomFieldVariables(
  groups: VariableGroup[],
  customFields: Array<{ key: string; label: string }> | undefined,
  token: (key: string) => string
): VariableGroup[] {
  if (!customFields || customFields.length === 0) return groups;
  return groups.map(g =>
    g.label === 'Lead'
      ? { ...g, vars: [...g.vars, ...customFields.map(cf => ({ key: token(cf.key), description: `Campo: ${cf.label}` }))] }
      : g
  );
}
