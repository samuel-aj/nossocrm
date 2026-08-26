'use client';

/**
 * Hooks de dados (TanStack Query) das telas de Agentes de IA e Robôs.
 * Consomem as rotas /api/wa-agents/**. Todas as chaves começam com 'waAgents'.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import type {
  AgentDocumentInputSchema,
  AgentDocumentRow,
  AgentInput,
  AgentMediaInputSchema,
  AgentMediaRow,
  AgentMinimal,
  AgentProvider,
  AgentPublic,
  BotInput,
  BotRow,
  BotRunRow,
  RunRow,
} from '@/lib/wa-agents/types';

export const WA_AGENTS_QUERY_KEY = 'waAgents';

/** Item da lista: admin recebe AgentPublic, demais recebem só o mínimo. */
export type WaAgentListItem = AgentMinimal & Partial<AgentPublic>;

export type WaAgentOptions = {
  connections: Array<{ id: string; label: string; provider: string; status: string }>;
  boards: Array<{ id: string; name: string; stages: Array<{ id: string; label: string; order: number }> }>;
  owners: Array<{ id: string; name: string }>;
  tags: string[];
};

export type WaRunsFilters = {
  agentId?: string;
  conversationId?: string;
  limit?: number;
  before?: string;
};

export type WaRunsResult = { runs: RunRow[]; agents: Record<string, string> };
export type WaBotRunsResult = { runs: BotRunRow[]; bots: Record<string, string> };

export type WaTestMessage = { role: 'user' | 'assistant'; text: string };
export type WaTestResult = { text: string; lines: string[]; toolCalls: unknown[]; usage: unknown };

/** IA na configuração: gerar do zero, melhorar o roteiro atual ou aplicar um ajuste pedido. */
export type WaAssistMode = 'generate' | 'improve' | 'adjust';
export type WaAssistVars = {
  mode: WaAssistMode;
  description?: string;
  current_prompt?: string;
  instruction?: string;
  /** adjust: o que o agente fez de errado (sinônimo de instruction) */
  feedback?: string;
  /** adjust: últimas mensagens do chat de teste, para contextualizar o ajuste */
  examples?: WaTestMessage[];
  provider?: AgentProvider;
  model?: string;
};

/** Documentos (base de conhecimento) e mídias do agente. */
export type WaAgentDocumentInput = z.input<typeof AgentDocumentInputSchema>;
export type WaAgentMediaInput = z.input<typeof AgentMediaInputSchema>;
export type WaAgentMediaKind = AgentMediaRow['kind'];
export type WaAgentFileKind = 'doc' | 'media';
/** Sugestão de resultado ou de ação durante a conversa (sem as ações do CRM). */
export type WaAssistSuggestion = { key: string; label: string; description: string };
export type WaAssistResult = {
  persona_name: string;
  system_prompt: string;
  outcomes: WaAssistSuggestion[];
  custom_actions: WaAssistSuggestion[];
};

/** Chamada padrão às rotas: cookies da sessão + JSON; erro vira Error com a mensagem do servidor. */
export async function waAgentsFetch<T>(
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error || `Falha (HTTP ${res.status})`);
  return (json ?? ({} as T)) as T;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------- Agentes

/** Lista de agentes (admin: completa; demais: só id/nome/persona/ligado). */
export function useWaAgentsList() {
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'list'],
    queryFn: async () => {
      const json = await waAgentsFetch<{ agents: WaAgentListItem[] }>('/api/wa-agents/agents');
      return json.agents ?? [];
    },
    staleTime: 30 * 1000,
  });
}

/** Um agente completo (admin). */
export function useWaAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'agent', id ?? ''],
    queryFn: async () => {
      const json = await waAgentsFetch<{ agent: AgentPublic }>(`/api/wa-agents/agents/${id}`);
      return json.agent;
    },
    enabled: !!id,
  });
}

export type SaveWaAgentVars = { id?: string | null; input: Partial<AgentInput> };

/** Cria (sem id) ou atualiza (com id) um agente. Devolve o agente salvo. */
export function useSaveWaAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: SaveWaAgentVars): Promise<AgentPublic> => {
      const json = id
        ? await waAgentsFetch<{ agent: AgentPublic }>(`/api/wa-agents/agents/${id}`, { method: 'PATCH', body: input })
        : await waAgentsFetch<{ agent: AgentPublic }>('/api/wa-agents/agents', { method: 'POST', body: input });
      return json.agent;
    },
    onSuccess: () => {
      // Prefixo inteiro: cobre 'list', 'agent' e o ['waAgents', 'minimal'] usado pelo chat.
      void qc.invalidateQueries({ queryKey: [WA_AGENTS_QUERY_KEY] });
    },
  });
}

/** Exclui um agente (desvincula as conversas). */
export function useDeleteWaAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await waAgentsFetch<{ ok: boolean }>(`/api/wa-agents/agents/${id}`, { method: 'DELETE' });
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [WA_AGENTS_QUERY_KEY] });
    },
  });
}

/** Opções para os formulários: números conectados, boards/etapas, responsáveis, rótulos. */
export function useWaAgentOptions() {
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'options'],
    queryFn: async () => {
      const json = await waAgentsFetch<Partial<WaAgentOptions>>('/api/wa-agents/options');
      const options: WaAgentOptions = {
        connections: json.connections ?? [],
        boards: json.boards ?? [],
        owners: json.owners ?? [],
        tags: json.tags ?? [],
      };
      return options;
    },
    staleTime: 60 * 1000,
  });
}

/** Execuções dos agentes (admin), com filtros. */
export function useWaRuns(filters: WaRunsFilters = {}) {
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'runs', filters],
    queryFn: async () => {
      const json = await waAgentsFetch<Partial<WaRunsResult>>(
        `/api/wa-agents/runs${toQuery({
          agentId: filters.agentId,
          conversationId: filters.conversationId,
          limit: filters.limit,
          before: filters.before,
        })}`
      );
      const result: WaRunsResult = { runs: json.runs ?? [], agents: json.agents ?? {} };
      return result;
    },
    staleTime: 15 * 1000,
  });
}

/** Teste de um agente salvo: envia o histórico e recebe a resposta sem disparar nada. */
export function useTestWaAgent(id: string | null | undefined) {
  return useMutation({
    mutationFn: async (vars: { messages: WaTestMessage[]; state?: Record<string, unknown> }): Promise<WaTestResult> => {
      if (!id) throw new Error('Salve o agente antes de testar');
      const json = await waAgentsFetch<Partial<WaTestResult>>(`/api/wa-agents/agents/${id}/test`, {
        method: 'POST',
        body: vars,
      });
      return {
        text: json.text ?? '',
        lines: json.lines ?? [],
        toolCalls: json.toolCalls ?? [],
        usage: json.usage ?? null,
      };
    },
  });
}

/** IA na configuração: POST /api/wa-agents/assist. Não altera nada no servidor; a UI decide o que aplicar. */
export function useWaAgentAssist() {
  return useMutation({
    mutationFn: async (vars: WaAssistVars): Promise<WaAssistResult> => {
      const json = await waAgentsFetch<Partial<WaAssistResult>>('/api/wa-agents/assist', {
        method: 'POST',
        body: vars,
      });
      return {
        persona_name: typeof json.persona_name === 'string' ? json.persona_name : '',
        system_prompt: typeof json.system_prompt === 'string' ? json.system_prompt : '',
        outcomes: Array.isArray(json.outcomes) ? json.outcomes : [],
        custom_actions: Array.isArray(json.custom_actions) ? json.custom_actions : [],
      };
    },
  });
}

// ---------------------------------------------------------------- Documentos e mídias

const documentsKey = (agentId: string | null | undefined) => [WA_AGENTS_QUERY_KEY, 'documents', agentId ?? ''];
const mediaKey = (agentId: string | null | undefined) => [WA_AGENTS_QUERY_KEY, 'media', agentId ?? ''];

/**
 * Sobe um arquivo do agente direto para o bucket privado `wa-agent-files`
 * (o arquivo não passa pela Vercel): pede { path, token } em POST /uploads e
 * usa `uploadToSignedUrl`. Devolve o caminho para registrar o documento/mídia.
 */
export async function uploadWaAgentFile(input: {
  agentId: string;
  file: File;
  kind: WaAgentFileKind;
  mime: string;
}): Promise<{ path: string }> {
  const fileName = input.file.name || `arquivo_${Date.now()}`;
  const up = await waAgentsFetch<{ path?: string; token?: string }>('/api/wa-agents/uploads', {
    method: 'POST',
    body: { agentId: input.agentId, fileName, kind: input.kind },
  });
  if (!up.path || !up.token) throw new Error('Falha ao preparar o upload');

  const supabase = createClient();
  if (!supabase) throw new Error('Supabase não configurado');
  const { error } = await supabase.storage
    .from('wa-agent-files')
    .uploadToSignedUrl(up.path, up.token, input.file, { contentType: input.mime || 'application/octet-stream' });
  if (error) throw new Error(`Upload falhou: ${error.message}`);
  return { path: up.path };
}

/** Documentos da base de conhecimento; consulta a cada 5 s enquanto algum estiver em processamento. */
export function useWaAgentDocuments(agentId: string | null | undefined) {
  return useQuery({
    queryKey: documentsKey(agentId),
    queryFn: async () => {
      const json = await waAgentsFetch<{ documents: AgentDocumentRow[] }>(`/api/wa-agents/agents/${agentId}/documents`);
      return json.documents ?? [];
    },
    enabled: !!agentId,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === 'processing') ? 5000 : false),
  });
}

/** Registra um documento já enviado ao bucket (o servidor extrai, divide e indexa em segundo plano). */
export function useAddWaAgentDocument(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WaAgentDocumentInput): Promise<AgentDocumentRow> => {
      if (!agentId) throw new Error('Salve o agente antes de enviar documentos');
      const json = await waAgentsFetch<{ document: AgentDocumentRow }>(`/api/wa-agents/agents/${agentId}/documents`, {
        method: 'POST',
        body: input,
      });
      return json.document;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentsKey(agentId) });
    },
  });
}

/** Exclui um documento (trechos, linha e arquivo). */
export function useDeleteWaAgentDocument(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docId: string) => {
      await waAgentsFetch<{ ok: boolean }>(`/api/wa-agents/agents/${agentId}/documents/${docId}`, { method: 'DELETE' });
      return docId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentsKey(agentId) });
    },
  });
}

/** Reprocessa um documento (extrai e indexa de novo). */
export function useReprocessWaAgentDocument(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docId: string) => {
      await waAgentsFetch<{ ok?: boolean; document?: AgentDocumentRow }>(
        `/api/wa-agents/agents/${agentId}/documents/${docId}/reprocess`,
        { method: 'POST' }
      );
      return docId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentsKey(agentId) });
    },
  });
}

/** Mídias que o agente pode enviar. */
export function useWaAgentMedia(agentId: string | null | undefined) {
  return useQuery({
    queryKey: mediaKey(agentId),
    queryFn: async () => {
      const json = await waAgentsFetch<{ media: AgentMediaRow[] }>(`/api/wa-agents/agents/${agentId}/media`);
      return json.media ?? [];
    },
    enabled: !!agentId,
    staleTime: 30 * 1000,
  });
}

/** Registra uma mídia já enviada ao bucket. */
export function useAddWaAgentMedia(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WaAgentMediaInput): Promise<AgentMediaRow> => {
      if (!agentId) throw new Error('Salve o agente antes de enviar mídias');
      const json = await waAgentsFetch<{ media: AgentMediaRow }>(`/api/wa-agents/agents/${agentId}/media`, {
        method: 'POST',
        body: input,
      });
      return json.media;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mediaKey(agentId) });
    },
  });
}

/** Atualiza nome e/ou descrição ("quando enviar") de uma mídia. */
export function useUpdateWaAgentMedia(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { mediaId: string; name?: string; description?: string }): Promise<AgentMediaRow> => {
      const { mediaId, ...body } = vars;
      const json = await waAgentsFetch<{ media: AgentMediaRow }>(`/api/wa-agents/agents/${agentId}/media/${mediaId}`, {
        method: 'PATCH',
        body,
      });
      return json.media;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mediaKey(agentId) });
    },
  });
}

/** Exclui uma mídia (linha e arquivo). */
export function useDeleteWaAgentMedia(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mediaId: string) => {
      await waAgentsFetch<{ ok: boolean }>(`/api/wa-agents/agents/${agentId}/media/${mediaId}`, { method: 'DELETE' });
      return mediaId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mediaKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------- Robôs

/** Lista de robôs (admin). */
export function useWaBotsList() {
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'bots'],
    queryFn: async () => {
      const json = await waAgentsFetch<{ bots: BotRow[] }>('/api/wa-agents/bots');
      return json.bots ?? [];
    },
    staleTime: 30 * 1000,
  });
}

export type SaveWaBotVars = { id?: string | null; input: Partial<BotInput> };

/** Cria (sem id) ou atualiza (com id) um robô. */
export function useSaveWaBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: SaveWaBotVars): Promise<BotRow> => {
      const json = id
        ? await waAgentsFetch<{ bot: BotRow }>(`/api/wa-agents/bots/${id}`, { method: 'PATCH', body: input })
        : await waAgentsFetch<{ bot: BotRow }>('/api/wa-agents/bots', { method: 'POST', body: input });
      return json.bot;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [WA_AGENTS_QUERY_KEY, 'bots'] });
    },
  });
}

/** Exclui um robô (cancela execuções abertas). */
export function useDeleteWaBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await waAgentsFetch<{ ok: boolean }>(`/api/wa-agents/bots/${id}`, { method: 'DELETE' });
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [WA_AGENTS_QUERY_KEY, 'bots'] });
      void qc.invalidateQueries({ queryKey: [WA_AGENTS_QUERY_KEY, 'botRuns'] });
    },
  });
}

/** Execuções dos robôs (admin), opcionalmente de um robô só. */
export function useWaBotRuns(botId?: string | null, limit?: number) {
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'botRuns', botId ?? '', limit ?? 0],
    queryFn: async () => {
      const json = await waAgentsFetch<Partial<WaBotRunsResult>>(
        `/api/wa-agents/bot-runs${toQuery({ botId: botId ?? undefined, limit })}`
      );
      const result: WaBotRunsResult = { runs: json.runs ?? [], bots: json.bots ?? {} };
      return result;
    },
    staleTime: 15 * 1000,
  });
}

/** Dispara um robô manualmente para um negócio ou telefone. */
export function useStartWaBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; dealId?: string; phone?: string }) => {
      const body: { dealId?: string; phone?: string } = {};
      if (vars.dealId) body.dealId = vars.dealId;
      if (vars.phone) body.phone = vars.phone;
      return waAgentsFetch<{ ok: boolean; runId?: string; error?: string }>(`/api/wa-agents/bots/${vars.id}/start`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [WA_AGENTS_QUERY_KEY, 'botRuns'] });
    },
  });
}
