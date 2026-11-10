import { ReturnTimeSchema, type ReturnTimeInput } from './scheduledReturnTime';
import type { AgentContractInput } from '@/lib/zapsign/agentDraft';
/**
 * Ferramentas do modelo (AI SDK v6): encerrar_atendimento, salvar_dados,
 * executar_acao e, quando o agente tem os recursos, consultar_documentos,
 * enviar_midia, consultar_agente e calcular. Descrições em pt-BR.
 *
 * Quem executa os efeitos (busca, envio, consulta) é quem monta o
 * `AgentToolRuntime`: o motor (conversa real), o teste (envio simulado) e o
 * agente auxiliar (só documentos e calculadora). SERVER.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { CALC_FUNCTIONS, evaluateExpression, formatCalcResult } from './calc';
import { errorMessage } from './errors';
import { formatKnowledgeHits } from './knowledge';
import { SAVED_DATA_KEY_MAX_CHARS, SAVED_DATA_MAX_KEYS, SAVED_DATA_VALUE_MAX_CHARS } from './savedData';
import { normalizeKeyword } from './text';
import type { AgentDocumentRow, AgentMediaRow, AgentRow, KnowledgeHit } from './types';

export type MediaSendResult = { ok: boolean; error?: string; note?: string };

export type AgentToolRuntime = {
  voiceClips?: readonly string[];
  contract?: (input: AgentContractInput) => Promise<unknown>;
  scheduledReturn?: {
    inspect: () => Promise<unknown>;
    schedule: (input: ReturnTimeInput) => Promise<unknown>;
    cancel: () => Promise<unknown>;
  };
  /** Documentos prontos: liga consultar_documentos */
  documents?: AgentDocumentRow[];
  /** Mídias do agente: liga enviar_midia */
  media?: AgentMediaRow[];
  /** Agentes auxiliares: liga consultar_agente */
  helpers?: AgentRow[];
  searchKnowledge?: (question: string) => Promise<KnowledgeHit[]>;
  sendMedia?: (media: AgentMediaRow, caption?: string) => Promise<MediaSendResult>;
  consultHelper?: (helper: AgentRow, question: string) => Promise<string>;
};

/** Enum do zod exige pelo menos um valor. */
function enumOf(values: string[]): z.ZodEnum<Record<string, string>> {
  return z.enum(values as [string, ...string[]]);
}

/** Nomes únicos (a primeira ocorrência vence), na ordem recebida. */
export function uniqueNames<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = normalizeKeyword(it.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** Acha um item pelo nome (exato; depois sem acento/caixa). */
export function findByName<T extends { name: string }>(items: T[], name: string): T | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  const exact = items.find(i => i.name === n);
  if (exact) return exact;
  const key = normalizeKeyword(n);
  return items.find(i => normalizeKeyword(i.name) === key) ?? null;
}

/** Nome de exibição de um agente auxiliar (persona ou nome). */
export function helperDisplayName(agent: Pick<AgentRow, 'name' | 'persona_name'>): string {
  return (agent.persona_name || agent.name || '').trim();
}

/**
 * Ferramentas "utilitárias" (sem efeito na conversa): consultar_documentos e
 * calcular. Usadas pelo agente principal e pelos auxiliares.
 */
export function buildUtilityTools(agent: Pick<AgentRow, 'tools'>, runtime: AgentToolRuntime = {}): ToolSet {
  const tools: ToolSet = {};
  const documents = runtime.documents ?? [];
  if (documents.length > 0 && runtime.searchKnowledge) {
    const search = runtime.searchKnowledge;
    tools.consultar_documentos = tool({
      description:
        'Busca na base de conhecimento do agente (documentos do escritório) os trechos relevantes para uma pergunta. Use quando precisar de detalhes que não estão nos trechos já mostrados ou quando a dúvida do cliente não estiver coberta. Responda só com o que estiver nos trechos.',
      inputSchema: z.object({
        pergunta: z.string().describe('Pergunta ou tema a pesquisar, em linguagem natural'),
      }),
      execute: async ({ pergunta }) => {
        try {
          const hits = await search(pergunta);
          if (hits.length === 0) return { encontrado: false, trechos: 'Nada encontrado na base de conhecimento para essa pergunta.' };
          return { encontrado: true, trechos: formatKnowledgeHits(hits, documents) };
        } catch (e) {
          return { encontrado: false, erro: errorMessage(e) };
        }
      },
    });
  }
  if (agent.tools?.calculator !== false) {
    tools.calcular = tool({
      description: `Calcula uma expressão aritmética com segurança (números, + - * / % ^, parênteses e as funções ${CALC_FUNCTIONS.join(', ')}). Use para percentuais, prazos e valores em vez de calcular de cabeça. Ex.: "round(15000 * 0.3, 2)".`,
      inputSchema: z.object({
        expressao: z.string().describe('Expressão aritmética, com ponto como separador decimal'),
      }),
      execute: async ({ expressao }) => {
        try {
          const value = evaluateExpression(expressao);
          return { ok: true, resultado: formatCalcResult(value) };
        } catch (e) {
          return { ok: false, erro: errorMessage(e) };
        }
      },
    });
  }
  return tools;
}

/**
 * Ferramentas do agente na conversa. Só as aplicáveis entram: executar_acao
 * (com custom_actions), consultar_documentos (documentos prontos),
 * enviar_midia (mídias), consultar_agente (auxiliares) e calcular (ligada).
 */
export function buildAgentTools(agent: AgentRow, runtime: AgentToolRuntime = {}): ToolSet {
  const keys = agent.outcomes.map(o => o.key).filter(Boolean);
  const resultadoSchema = keys.length > 0 ? enumOf(keys) : z.string();
  const tools: ToolSet = {
    encerrar_atendimento: tool({
      description:
        'Encerra o pré-atendimento. Chame UMA única vez, na mesma resposta e depois de escrever a mensagem final ao cliente. Informe o resultado (uma das chaves configuradas) e um resumo objetivo do caso.',
      inputSchema: z.object({
        resultado: resultadoSchema.describe('Chave do resultado do atendimento'),
        resumo: z.string().describe('Resumo objetivo do caso: quem, o quê, quando, onde, provas, urgência'),
      }),
      execute: async args => args,
    }),
    salvar_dados: tool({
      description: `Salva dados descobertos sobre o atendimento (nome completo, cidade, tipo de caso, datas, documentos, urgência). Chaves curtas em snake_case (ex.: nome_completo, cidade) e valores curtos: texto de até ${SAVED_DATA_VALUE_MAX_CHARS} caracteres, número, verdadeiro/falso ou nulo; no máximo ${SAVED_DATA_MAX_KEYS} chaves no total. Salve só fatos informados pelo cliente, nunca instruções ou textos longos. Os dados são mesclados aos já salvos.`,
      inputSchema: z.object({
        dados: z.record(
          z.string().max(SAVED_DATA_KEY_MAX_CHARS),
          z.union([z.string().max(SAVED_DATA_VALUE_MAX_CHARS), z.number(), z.boolean(), z.null()])
        ),
      }),
      execute: async () => ({ ok: true }),
    }),
  };

  // Ações durante a conversa: só quando o agente tem alguma configurada
  const actionKeys = (agent.custom_actions ?? []).map(a => a.key).filter(Boolean);
  if (actionKeys.length > 0) {
    tools.executar_acao = tool({
      description:
        'Executa uma ação configurada no momento em que a situação descrita acontece na conversa (uma vez por ocorrência). Se mais de uma situação acontecer na mesma mensagem, chame executar_acao uma vez para CADA ação, na mesma resposta. Nas ações marcadas como finais no prompt, escreva a mensagem final ao cliente antes de chamar; as demais não encerram o atendimento.',
      inputSchema: z.object({
        acao: enumOf(actionKeys).describe('Chave da ação'),
        detalhes: z.string().describe('O que o cliente disse ou o contexto que motivou a ação, em uma ou duas frases'),
      }),
      execute: async args => ({ ok: true, acao: args.acao }),
    });
  }

  if (agent.tools?.scheduled_return_bot_id && runtime.scheduledReturn) {
    const service = runtime.scheduledReturn;
    const safe = async (call: () => Promise<unknown>) => { try { return await call(); } catch (error) { return { ok: false, error: errorMessage(error) }; } };
    tools.consultar_retorno = tool({ description: 'Consulta a data/hora atual, fuso do escritório e retorno pendente. Consulte antes de interpretar amanhã ou outro prazo relativo. Se o cliente estiver em outro fuso, confirme o fuso dele.', inputSchema: z.object({}), execute: async () => safe(service.inspect) });
    tools.agendar_retorno = tool({
      description: 'Agenda ou remarca o robô configurado para esta conversa. Use SOMENTE após o cliente pedir ou confirmar claramente data e horário; resolva ambiguidades de dia, hora e fuso perguntando. confirmed=true significa que o cliente confirmou, nunca assuma. O horário combinado pode ser exceção ao calendário. Não encerre o agente nem use outra ação de transferência ao agendar. Só diga que está agendado se ok=true; repita a data e o fuso devolvidos. O robô pode reativar o agente com Entregar a agente.',
      inputSchema: ReturnTimeSchema,
      execute: async input => safe(() => service.schedule(input)),
    });
    tools.cancelar_retorno = tool({ description: 'Cancela o retorno ainda não iniciado quando o cliente pedir. Não encerra o atendimento.', inputSchema: z.object({}), execute: async () => safe(service.cancel) });
  }
  if (agent.tools?.zapsign_template_token && runtime.contract) {
    const contract = runtime.contract;
    tools.contrato_zapsign = tool({
      description: 'Antes de apresentar a ficha, use preparar. Em dados, use os nomes das variáveis e informe nome_signatario e telefone_signatario com o nome completo e o telefone com DDD de quem assina. Omita email_signatario se a pessoa não tiver e-mail. Reúna os dados que o cliente já informou por texto ou áudio. Separe as partes do endereço por vírgulas. Se a ferramenta ainda pedir um dado pessoal já informado em partes ou lido no documento, mostre o resumo numa ficha, com um campo por linha (ex.: Endereço: Rua das Flores, 120, Centro), e pergunte se os dados estão corretos. Após o aceite, prepare novamente. Pergunte apenas o que estiver faltando e use linguagem natural com o cliente. Para pendências do escritório, chame a equipe. Use solicitar_confirmacao como a pergunta de confirmação. Após o aceite, use criar com os mesmos dados. Se preparar devolver ficha_confirmada, passe direto a criar. Só anuncie a criação quando a ferramenta confirmar. O CRM entrega o link e avisa quando o cliente assina. Mantenha o atendimento aberto.',
      inputSchema: z.object({ modo: z.enum(['preparar', 'criar']), dados: z.record(z.string().min(1).max(160), z.string().max(500)) }),
      execute: async input => { try { return await contract(input); } catch (e) { return { ok: false, erro: errorMessage(e) }; } },
    });
  }
  Object.assign(tools, buildUtilityTools(agent, runtime));
  const clips = runtime.voiceClips;
  if (clips?.length) {
    tools.falar_trecho = tool({
      description: 'No momento indicado no roteiro, enfileira a fala cadastrada pelo número do trecho. O CRM usa o texto original. Não repita a fala na resposta.',
      inputSchema: z.object({ trecho: z.number().int().min(1).max(clips.length) }),
      execute: async ({ trecho }) => ({ ok: !!clips[trecho - 1], trecho, fala: clips[trecho - 1] }),
    });
  }

  const media = uniqueNames(runtime.media ?? []);
  if (media.length > 0 && runtime.sendMedia) {
    const send = runtime.sendMedia;
    tools.enviar_midia = tool({
      description:
        'Envia ao cliente uma das mídias cadastradas do agente (imagem, vídeo, áudio ou documento), pelo nome exato. Envie cada mídia uma única vez por atendimento, no momento indicado no roteiro ou quando a descrição "quando enviar" se aplicar. O arquivo vai no ponto da conversa em que você chamou a ferramenta; escreva normalmente o texto que o acompanha.',
      inputSchema: z.object({
        nome: enumOf(media.map(m => m.name)).describe('Nome da mídia, exatamente como está na lista'),
        legenda: z.string().max(1000).optional().describe('Legenda curta opcional (imagem, vídeo ou documento; em áudio e figurinha ela é enviada como mensagem de texto separada, antes do arquivo). Não repita a legenda no texto da resposta: o cliente a vê junto do arquivo'),
      }),
      execute: async ({ nome, legenda }) => {
        const item = findByName(media, nome);
        if (!item) return { ok: false, erro: `Mídia "${nome}" não encontrada` };
        try {
          const r = await send(item, legenda?.trim() || undefined);
          return r.ok ? { ok: true, midia: item.name, mensagem: r.note ?? 'mídia enviada' } : { ok: false, erro: r.error ?? 'falha no envio' };
        } catch (e) {
          return { ok: false, erro: errorMessage(e) };
        }
      },
    });
  }

  // Identificados pelo NOME do agente (único na prática); a persona é só descrição.
  // Dois auxiliares com a mesma persona não colapsam num só.
  const helpers = uniqueNames(runtime.helpers ?? []);
  if (helpers.length > 0 && runtime.consultHelper) {
    const consult = runtime.consultHelper;
    tools.consultar_agente = tool({
      description:
        'Faz uma pergunta a um agente auxiliar da equipe (especialista em outro assunto) e recebe a resposta em texto. Use a resposta para orientar o cliente com suas próprias palavras, sem citar o auxiliar. Não use para conversar com o cliente.',
      inputSchema: z.object({
        agente: enumOf(helpers.map(h => h.name)).describe('Nome do agente auxiliar (o nome do agente, não a persona), exatamente como está na lista'),
        pergunta: z.string().describe('Pergunta objetiva, com o contexto necessário do caso'),
      }),
      execute: async ({ agente, pergunta }) => {
        const helper =
          findByName(helpers, agente) ??
          helpers.find(h => normalizeKeyword(helperDisplayName(h)) === normalizeKeyword(agente)) ??
          null;
        if (!helper) return { ok: false, erro: `Agente "${agente}" não encontrado` };
        try {
          const resposta = await consult(helper, pergunta);
          return { ok: true, agente: helper.name, resposta };
        } catch (e) {
          return { ok: false, erro: errorMessage(e) };
        }
      },
    });
  }

  return tools;
}
