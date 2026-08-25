/**
 * IA na configuração do agente: gera, melhora ou ajusta o roteiro (system
 * prompt) já nas convenções do CRM, e sugere persona, resultados do
 * encerramento e ações durante a conversa.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { getModel } from '@/lib/ai/config';
import { MODEL_CATALOG, PROMPT_VARIABLES, PROVIDER_LABELS } from './catalog';
import { WaAgentError } from './errors';
import { getOrganizationApiKey, supportsTemperature } from './model';
import { normalizeKeyword } from './text';
import { AI_PROVIDERS, type AgentProvider, type AssistInput, type AssistResult, type AssistSuggestion } from './types';

const MAX_SUGGESTIONS = 12;

/** Esquema do objeto gerado pelo modelo. */
const AssistObjectSchema = z.object({
  persona_name: z.string().describe('Primeiro nome da persona do agente (ex.: Ana). Curto, sem sobrenome.'),
  system_prompt: z
    .string()
    .describe('Roteiro completo do agente em português do Brasil, com as seções e convenções pedidas.'),
  outcomes: z
    .array(
      z.object({
        key: z.string().describe('Chave curta em minúsculas, sem acento, com hífens (ex.: qualificado)'),
        label: z.string().describe('Nome curto do resultado (ex.: Qualificado)'),
        description: z.string().describe('Quando este resultado se aplica, em uma frase'),
      })
    )
    .describe('Resultados possíveis do encerramento (encerrar_atendimento)'),
  custom_actions: z
    .array(
      z.object({
        key: z.string().describe('Chave curta em minúsculas, sem acento, com hífens (ex.: ja-tem-advogado)'),
        label: z.string().describe('Nome curto da ação (ex.: Já tem advogado)'),
        description: z
          .string()
          .describe('Quando acontecer, em linguagem natural, começando por "o cliente..." (ex.: o cliente informar que já tem advogado)'),
      })
    )
    .describe('Ações durante a conversa (executar_acao). Pode ser vazio.'),
});

/** Convenções do CRM que o modelo precisa seguir ao escrever o roteiro. */
export function buildAssistSystemPrompt(): string {
  const vars = PROMPT_VARIABLES.map(v => `- ${v.key}: ${v.description}`).join('\n');
  return `Você é especialista em escrever roteiros (system prompts) para agentes de pré-atendimento por WhatsApp de escritórios de advocacia e empresas de serviços que usam o NossoCRM. Escreva SEMPRE em português do Brasil, sem travessão (use vírgula, ponto ou dois-pontos). Nunca invente dados do escritório: onde faltar informação, deixe uma indicação clara entre colchetes, como [nome da área] ou [prazo de retorno].

## COMO O AGENTE FUNCIONA NO CRM
- O roteiro é o system prompt do agente. O CRM acrescenta sozinho, depois do roteiro, as instruções técnicas (regra de divisão das mensagens, dados salvos, resultados do encerramento, ações). Não repita nomes de ferramenta em excesso: o roteiro deve ser natural.
- O agente conversa pelo WhatsApp. Cada quebra de linha da resposta vira uma mensagem separada: uma ideia por linha, no máximo 3 linhas por resposta, nunca linhas em branco, sem markdown (negrito, títulos, listas) nas respostas ao cliente.
- O agente NÃO é advogado e não dá parecer jurídico: faz a triagem, coleta as informações e encaminha para a equipe.
- Encerramento: quando tiver o que precisa (ou ficar claro que o caso não é da casa), o agente escreve a mensagem final e, na mesma resposta, DEPOIS dela, chama a ferramenta encerrar_atendimento uma única vez informando o resultado (uma das chaves configuradas) e um resumo objetivo (quem, o quê, quando, onde, provas, urgência). Depois disso não continua a conversa.
- Ações durante a conversa: situações que acontecem no meio do atendimento (ex.: o cliente diz que já tem advogado, pede para falar com humano, informa que é urgente). O agente chama executar_acao com a chave da ação, uma vez por ocorrência, e continua a conversa normalmente. Só sugira ações quando fizer sentido para o atendimento descrito.
- Variáveis disponíveis no roteiro (o CRM substitui pelos valores reais):
${vars}

## FORMATO DO ROTEIRO (system_prompt)
Use exatamente estas seções, em markdown simples (só títulos com #), nesta ordem:
# PAPEL (quem é a persona, para quem trabalha, o que faz e o que NÃO faz; use {{nome_agente}}, {{nome_escritorio}}, {{data_hora}}, {{nome_lead}}, {{telefone}} e o contexto do negócio {{negocio.titulo}} / {{negocio.etapa}})
# COMO COMEÇAR (cumprimentar pelo {{primeiro_nome}}, apresentar-se uma única vez, não pedir para repetir o que já foi dito, continuar de onde parou quando há histórico)
# O QUE DESCOBRIR (uma pergunta por vez) (lista numerada das informações a coletar, específica da área; instrução de fazer UMA pergunta por mensagem e não repetir perguntas já respondidas)
# ENCERRAMENTO (quando encerrar, o que dizer na mensagem final, chamar encerrar_atendimento uma única vez com o resultado certo)
# REGRAS INVIOLÁVEIS (nunca prometer resultado, prazo ou valor; nunca informar honorários; nunca inventar informações; não dar orientação jurídica; respeitar pedido de falar com humano; lidar com grosseria; não sair do assunto)
# TOM (português do Brasil, claro e acolhedor, frases curtas, sem juridiquês, sem listas/negrito/markdown, primeiro nome com moderação, no máximo um emoji por mensagem)
# REGRA DE DIVISÃO DAS MENSAGENS (cada quebra de linha vira uma mensagem; uma ideia por linha; no máximo 3 linhas; nunca linhas em branco; a pergunta fica sempre na última linha)

## RESULTADOS E AÇÕES
- outcomes: 3 a 6 resultados do encerramento com chave (minúsculas, sem acento, hífens), rótulo curto e descrição de quando se aplica. Inclua sempre um resultado para "análise humana" (caso complexo, urgente ou pedido de falar com alguém) e um para "falta informação" (a pessoa parou de responder). As chaves dos resultados precisam aparecer na seção ENCERRAMENTO do roteiro.
- custom_actions: 0 a 5 ações durante a conversa, com chave, rótulo e descrição em linguagem natural de quando acontecer. Não mencione as ações na seção ENCERRAMENTO.`;
}

function buildUserPrompt(input: AssistInput): string {
  const description = (input.description ?? '').trim();
  const current = (input.current_prompt ?? '').trim();
  const instruction = (input.instruction ?? '').trim();
  switch (input.mode) {
    case 'generate':
      return `Crie do zero o roteiro de um agente de pré-atendimento a partir desta descrição feita pelo administrador do CRM:\n\n"""\n${description}\n"""\n\nEntregue persona_name, system_prompt completo (todas as seções), outcomes e custom_actions coerentes com a descrição.`;
    case 'improve':
      return `Reescreva o roteiro abaixo corrigindo lacunas e deixando-o completo nas convenções do CRM (todas as seções, uma pergunta por vez, encerramento com encerrar_atendimento, regras invioláveis, tom, regra de divisão). MANTENHA o conteúdo, a área, a persona e as decisões do autor: melhore, não substitua. Sugira outcomes e custom_actions coerentes com o roteiro (se ele já cita resultados, mantenha as mesmas chaves).\n\nRoteiro atual:\n"""\n${current}\n"""`;
    case 'adjust':
      return `Aplique a instrução abaixo ao roteiro atual, mudando só o necessário e preservando todo o resto (estrutura, persona, seções, chaves dos resultados). Devolva o roteiro completo já ajustado, além de persona_name, outcomes e custom_actions coerentes com o resultado.\n\nInstrução do administrador:\n"""\n${instruction}\n"""\n\nRoteiro atual:\n"""\n${current}\n"""`;
    default:
      return description;
  }
}

/** Valida a entrada por modo (campos obrigatórios). */
export function validateAssistInput(input: AssistInput): string | null {
  if (input.mode === 'generate' && !(input.description ?? '').trim()) return 'Descreva o atendimento para gerar o roteiro';
  if (input.mode === 'improve' && !(input.current_prompt ?? '').trim()) return 'Não há roteiro para melhorar';
  if (input.mode === 'adjust') {
    if (!(input.current_prompt ?? '').trim()) return 'Não há roteiro para ajustar';
    if (!(input.instruction ?? '').trim()) return 'Informe o ajuste desejado';
  }
  return null;
}

/**
 * Modelo usado pela assistência: provedor/modelo informados (chave da org
 * daquele provedor) ou o provedor/modelo padrão da organização.
 */
export async function resolveAssistModel(
  admin: SupabaseClient,
  organizationId: string,
  input: { provider?: AgentProvider; model?: string }
): Promise<{ model: LanguageModel; provider: AgentProvider; modelId: string }> {
  let provider: AgentProvider | undefined = input.provider;
  let modelId = (input.model ?? '').trim();
  if (!provider) {
    const { data } = await admin
      .from('organization_settings')
      .select('ai_provider, ai_model')
      .eq('organization_id', organizationId)
      .maybeSingle();
    const row = (data ?? {}) as { ai_provider?: string | null; ai_model?: string | null };
    provider = AI_PROVIDERS.includes(row.ai_provider as AgentProvider) ? (row.ai_provider as AgentProvider) : 'google';
    if (!modelId) modelId = (row.ai_model ?? '').trim();
  }
  if (!modelId) modelId = MODEL_CATALOG[provider][0].id;

  const apiKey = await getOrganizationApiKey(admin, organizationId, provider);
  if (!apiKey) {
    throw new WaAgentError('AI_KEY_NOT_CONFIGURED', `Chave da API não configurada para ${PROVIDER_LABELS[provider]}`);
  }
  return { model: getModel(provider, apiKey, modelId) as LanguageModel, provider, modelId };
}

/** Chave válida (/^[a-z0-9_-]{1,40}$/) a partir de texto livre; fallback com o índice. */
export function slugifyKey(text: string, index: number): string {
  const slug = normalizeKeyword(text)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || `item-${index + 1}`;
}

function clip(text: string, max: number): string {
  const t = (text ?? '').trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

/** Normaliza as sugestões do modelo: chaves válidas e únicas, tamanhos dentro dos limites. */
export function normalizeSuggestions(
  items: Array<{ key?: string; label?: string; description?: string }>,
  opts: { descriptionMax: number; descriptionRequired: boolean }
): AssistSuggestion[] {
  const out: AssistSuggestion[] = [];
  const seen = new Set<string>();
  for (const [i, item] of (items ?? []).slice(0, MAX_SUGGESTIONS).entries()) {
    const label = clip(item.label || item.key || '', 80);
    if (!label) continue;
    let key = slugifyKey(item.key || label, i);
    let n = 2;
    while (seen.has(key)) key = `${key.slice(0, 37)}-${n++}`;
    seen.add(key);
    let description = clip(item.description || '', opts.descriptionMax);
    if (!description && opts.descriptionRequired) description = label;
    out.push({ key, label, description, actions: [] });
  }
  return out;
}

export async function assistAgentConfig(
  admin: SupabaseClient,
  input: { organizationId: string } & AssistInput
): Promise<AssistResult> {
  const invalid = validateAssistInput(input);
  if (invalid) throw new WaAgentError('VALIDATION_ERROR', invalid);

  const resolved = await resolveAssistModel(admin, input.organizationId, { provider: input.provider, model: input.model });
  const { object } = await generateObject({
    model: resolved.model,
    schema: AssistObjectSchema,
    schemaName: 'roteiro_do_agente',
    schemaDescription: 'Roteiro, persona, resultados do encerramento e ações durante a conversa de um agente de pré-atendimento',
    system: buildAssistSystemPrompt(),
    prompt: buildUserPrompt(input),
    temperature: supportsTemperature({ provider: resolved.provider, model: resolved.modelId }) ? 0.4 : undefined,
  });

  return {
    persona_name: clip(object.persona_name, 80),
    system_prompt: clip(object.system_prompt, 60000),
    outcomes: normalizeSuggestions(object.outcomes, { descriptionMax: 500, descriptionRequired: false }),
    custom_actions: normalizeSuggestions(object.custom_actions, { descriptionMax: 600, descriptionRequired: true }),
  };
}
