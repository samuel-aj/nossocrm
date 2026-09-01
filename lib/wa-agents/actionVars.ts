/**
 * Variáveis dos CAMPOS DE TEXTO das ações (resultados do encerramento e ações
 * durante a conversa), em duas camadas aplicadas nesta ordem:
 *
 *   1. {{ia:nome}}  -> preenchida pela IA DO AGENTE na hora da execução, uma
 *      chamada só por execução (todas as variáveis de uma vez), lendo a
 *      conversa. A instrução de cada nome vem de agent.ai_vars.
 *   2. {{a.b.c}}    -> variáveis do sistema (contato, negócio, data...), as
 *      mesmas do roteiro mais e-mail/empresa/resumo e os campos personalizados
 *      do negócio em {{campos.chave}}.
 *
 * A resolução das variáveis de IA é tolerante: se a chamada falhar, os nomes
 * caem no exemplo cadastrado (ou vazio) e o erro fica no registro da execução,
 * sem derrubar a esteira de ações.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { buildHistoryMessages, buildPromptVars, type ConversationContext } from './context';
import { errorMessage } from './errors';
import { resolveAgentModel, supportsTemperature } from './model';
import { extractAiVarNames, renderAiVars, renderTemplate } from './template';
import type { AgentAiVar, AgentRow, EndAction } from './types';

/** Campos de texto de uma ação que aceitam variáveis. */
export function actionTextFields(action: EndAction): string[] {
  switch (action.type) {
    case 'note':
      return [action.title ?? ''];
    case 'add_tag':
      return [action.tag];
    case 'mark_lost':
      return [action.loss_reason ?? ''];
    case 'append_description':
      return [action.prefix ?? ''];
    case 'create_task':
      return [action.title];
    case 'webhook':
      return [action.body_template ?? ''];
    default:
      return [];
  }
}

/** Variáveis do sistema disponíveis nos campos das ações. */
export function buildActionSystemVars(input: {
  agent: AgentRow;
  ctx: ConversationContext;
  /** resumo do encerramento ou detalhes da ação durante a conversa */
  summary: string;
}): Record<string, unknown> {
  const { agent, ctx, summary } = input;
  const base = buildPromptVars({ agent, ctx });
  const campos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.deal?.custom_fields ?? {})) campos[k] = v;
  return {
    ...base,
    email: ctx.contact?.email ?? '',
    empresa: ctx.contact?.company_name ?? '',
    resumo: summary,
    negocio: {
      ...base.negocio,
      valor: ctx.deal?.value ?? '',
      quadro: ctx.deal?.board_name ?? '',
      responsavel: ctx.deal?.owner_name ?? '',
    },
    campos,
  };
}

/** Instruções cadastradas dos nomes pedidos (nome -> variável); nomes sem cadastro ficam de fora. */
function pickAiVars(agent: AgentRow, names: string[]): AgentAiVar[] {
  const byName = new Map(agent.ai_vars.map(v => [v.name.toLowerCase(), v]));
  return names.map(n => byName.get(n)).filter((v): v is AgentAiVar => !!v);
}

/**
 * Gera os valores das variáveis de IA usadas nas ações, numa chamada só.
 * Devolve nome -> valor (nomes sem cadastro ou não devolvidos caem no exemplo
 * ou em ''); em erro, todos caem no exemplo/'' e o evento registra o motivo.
 */
export async function resolveAiVarValues(
  admin: SupabaseClient,
  input: {
    agent: AgentRow;
    ctx: ConversationContext;
    actions: EndAction[];
    pushEvent: (type: string, extra?: Record<string, unknown>) => void;
  }
): Promise<Record<string, string>> {
  const { agent, ctx, actions, pushEvent } = input;
  const names = extractAiVarNames(actions.flatMap(actionTextFields).join('\n'));
  if (names.length === 0) return {};

  const fallback: Record<string, string> = {};
  const vars = pickAiVars(agent, names);
  for (const n of names) fallback[n] = vars.find(v => v.name.toLowerCase() === n)?.example ?? '';
  const unknown = names.filter(n => !vars.some(v => v.name.toLowerCase() === n));
  if (unknown.length > 0) pushEvent('ai_vars_desconhecidas', { nomes: unknown });
  if (vars.length === 0) return fallback;

  try {
    const { model, modelId } = await resolveAgentModel(admin, ctx.conversation.organization_id, agent);
    const history = await buildHistoryMessages(admin, ctx, Math.min(agent.history_limit, 60));
    const spec = vars
      .map(v => `- "${v.name}": ${v.instruction}${v.example ? ` (exemplo de resultado: ${JSON.stringify(v.example)})` : ''}`)
      .join('\n');
    const system = [
      'Você extrai informações de uma conversa de WhatsApp entre um atendente e um cliente.',
      'Preencha os campos pedidos com base SOMENTE na conversa. Seja direto e curto (uma frase ou menos por campo).',
      'Se a conversa não tiver a informação, devolva "" para aquele campo. Nunca invente.',
      'Responda APENAS um objeto JSON com exatamente estas chaves:',
      spec,
    ].join('\n');
    const result = await generateText({
      model,
      system,
      messages: [
        ...history,
        { role: 'user', content: 'Preencha agora os campos pedidos, respondendo só o JSON.' },
      ],
      ...(supportsTemperature(agent) ? { temperature: 0 } : {}),
    });
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values: Record<string, string> = { ...fallback };
    for (const v of vars) {
      const got = parsed[v.name];
      if (typeof got === 'string') values[v.name.toLowerCase()] = got.trim().slice(0, 1000);
      else if (got !== null && got !== undefined) values[v.name.toLowerCase()] = String(got).slice(0, 1000);
    }
    pushEvent('ai_vars_preenchidas', { nomes: vars.map(v => v.name), modelo: modelId });
    return values;
  } catch (e) {
    pushEvent('ai_vars_falharam', { erro: errorMessage(e), nomes: vars.map(v => v.name) });
    return fallback;
  }
}

/** Aplica as duas camadas num campo de texto de ação. */
export function renderActionText(
  text: string,
  aiValues: Record<string, string>,
  systemVars: Record<string, unknown>
): string {
  return renderTemplate(renderAiVars(text, aiValues), systemVars);
}

/**
 * Ação com os campos de texto já resolvidos (variáveis substituídas). O corpo
 * do webhook NÃO passa pelas variáveis do sistema aqui: ele já é renderizado
 * no envio contra o payload (compatibilidade com {{contact.name}} etc.); só as
 * variáveis de IA são preenchidas antes.
 */
export function resolveActionTexts(
  action: EndAction,
  aiValues: Record<string, string>,
  systemVars: Record<string, unknown>
): EndAction {
  const r = (t: string) => renderActionText(t, aiValues, systemVars);
  switch (action.type) {
    case 'note':
      return { ...action, title: action.title ? r(action.title).slice(0, 120) : action.title };
    case 'add_tag':
      return { ...action, tag: r(action.tag).slice(0, 60) };
    case 'mark_lost':
      return { ...action, loss_reason: action.loss_reason ? r(action.loss_reason).slice(0, 200) : action.loss_reason };
    case 'append_description':
      return { ...action, prefix: action.prefix ? r(action.prefix).slice(0, 120) : action.prefix };
    case 'create_task':
      return { ...action, title: r(action.title).slice(0, 200) };
    case 'webhook': {
      if (!action.body_template) return action;
      // Corpo que parece JSON: o valor da IA entra escapado como conteúdo de
      // string (aspas e quebras de linha não quebram o JSON), a mesma regra do
      // renderJsonTemplate para as variáveis do payload.
      const jsonish = /^\s*[\[{]/.test(action.body_template);
      const valores = jsonish
        ? Object.fromEntries(Object.entries(aiValues).map(([k, v]) => [k, JSON.stringify(v).slice(1, -1)]))
        : aiValues;
      return { ...action, body_template: renderAiVars(action.body_template, valores) };
    }
    default:
      return action;
  }
}
