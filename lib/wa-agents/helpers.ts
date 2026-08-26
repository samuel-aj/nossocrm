/**
 * Agentes auxiliares (ferramenta consultar_agente): o agente principal faz
 * uma pergunta a outro agente da org e recebe um texto. O auxiliar responde
 * com o próprio roteiro e modelo, pode usar a própria base de conhecimento e
 * a calculadora, mas não envia nada nem executa ações. Nunca lança. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateText, stepCountIs } from 'ai';
import { buildPromptVars, replaceScriptMarkers, type ConversationContext } from './context';
import { errorMessage } from './errors';
import { formatKnowledgeHits, loadReadyDocuments, searchKnowledge } from './knowledge';
import { resolveAgentModel, supportsTemperature } from './model';
import { renderTemplate } from './template';
import { buildUtilityTools, helperDisplayName } from './tools';
import type { AgentRow } from './types';

/** Limite de tokens da resposta do auxiliar. */
const HELPER_MAX_OUTPUT_TOKENS = 800;
const HELPER_MAX_STEPS = 3;
const HELPER_ANSWER_MAX_CHARS = 4000;
const HELPER_KNOWLEDGE_LIMIT = 4;

export type ConsultHelperInput = {
  organizationId: string;
  helper: AgentRow;
  question: string;
  ctx: ConversationContext;
  /** Agente que está perguntando (só para o contexto do auxiliar) */
  askedBy?: Pick<AgentRow, 'name' | 'persona_name'> | null;
};

/** Prompt do auxiliar: roteiro dele (sem marcadores) + regras da consulta + trechos da base dele. */
export function buildHelperSystemPrompt(input: {
  helper: AgentRow;
  ctx: ConversationContext;
  askedBy?: Pick<AgentRow, 'name' | 'persona_name'> | null;
  knowledgeText?: string;
  hasDocuments?: boolean;
}): string {
  const { helper, ctx } = input;
  const vars = buildPromptVars({ agent: helper, ctx });
  const script = replaceScriptMarkers(renderTemplate(helper.system_prompt || '', vars as unknown as Record<string, unknown>), {
    strip: true,
  }).trim();
  const asker = input.askedBy ? helperDisplayName(input.askedBy) || input.askedBy.name : 'outro agente';

  const blocks: string[] = [];
  if (script) blocks.push(script);
  if (input.knowledgeText) {
    blocks.push(`## TRECHOS DA BASE DE CONHECIMENTO (relevantes para a pergunta)\n${input.knowledgeText}`);
  }
  const lines: string[] = ['## CONSULTA DE OUTRO AGENTE (obrigatório)'];
  lines.push(
    `- Você não está falando com o cliente: quem pergunta é ${asker}, agente da mesma equipe, que está atendendo ${vars.nome_lead || 'um lead'} pelo WhatsApp.`
  );
  lines.push(
    '- Responda à pergunta de forma objetiva e completa, em texto corrido (pode usar mais de um parágrafo), sem cumprimentos, sem se apresentar e sem markdown. Não faça perguntas de volta; se faltar informação, diga o que falta.'
  );
  lines.push('- Use o conhecimento do seu roteiro' + (input.hasDocuments ? ' e da sua base de conhecimento (ferramenta consultar_documentos)' : '') + '. Não invente dados; se não souber, diga que não sabe.');
  if (helper.tools?.calculator !== false) lines.push('- Para contas, use a ferramenta calcular.');
  lines.push('- Não chame ferramentas de envio nem encerre nada: sua resposta é só o texto para o outro agente.');
  blocks.push(lines.join('\n'));
  return blocks.join('\n\n').trim();
}

/**
 * Pergunta ao agente auxiliar e devolve o texto da resposta. Em erro devolve
 * um texto curto explicando (nunca lança).
 */
export async function consultHelperAgent(admin: SupabaseClient, input: ConsultHelperInput): Promise<string> {
  const { helper, ctx, organizationId } = input;
  const question = (input.question ?? '').trim();
  const name = helperDisplayName(helper) || helper.name;
  if (!question) return `Não foi possível consultar o agente ${name}: pergunta vazia.`;
  if (helper.organization_id !== organizationId) return `Não foi possível consultar o agente ${name}: agente de outra organização.`;
  if (!helper.enabled) return `Não foi possível consultar o agente ${name}: agente desligado.`;

  try {
    const resolved = await resolveAgentModel(admin, organizationId, helper);
    const documents = await loadReadyDocuments(admin, organizationId, helper.id).catch(() => []);
    const hits =
      documents.length > 0
        ? await searchKnowledge(admin, { organizationId, agent: helper, query: question, limit: HELPER_KNOWLEDGE_LIMIT })
        : [];
    const system = buildHelperSystemPrompt({
      helper,
      ctx,
      askedBy: input.askedBy,
      knowledgeText: formatKnowledgeHits(hits, documents),
      hasDocuments: documents.length > 0,
    });
    const tools = buildUtilityTools(helper, {
      documents,
      searchKnowledge: q => searchKnowledge(admin, { organizationId, agent: helper, query: q, limit: 5 }),
    });
    const result = await generateText({
      model: resolved.model,
      system,
      prompt: question,
      tools,
      temperature: supportsTemperature(helper) ? helper.temperature : undefined,
      maxOutputTokens: HELPER_MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(HELPER_MAX_STEPS),
    });
    const texts = result.steps.map(s => (s.text ?? '').trim()).filter(Boolean);
    const text = (texts.join('\n') || result.text || '').trim();
    if (!text) return `O agente ${name} não deu resposta para essa pergunta.`;
    return text.length > HELPER_ANSWER_MAX_CHARS ? `${text.slice(0, HELPER_ANSWER_MAX_CHARS)}…` : text;
  } catch (e) {
    const msg = errorMessage(e);
    console.error('[wa-agents] consulta ao agente auxiliar falhou:', msg);
    return `Não foi possível consultar o agente ${name}: ${msg.slice(0, 200)}.`;
  }
}
