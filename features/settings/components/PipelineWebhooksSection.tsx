import React, { useMemo, useState } from 'react';
import {
  Workflow,
  Plus,
  ArrowRight,
  Copy,
  Check,
  Link as LinkIcon,
  Pencil,
  Power,
  Trash2,
  KeyRound,
} from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { Modal } from '@/components/ui/Modal';
import ConfirmModal from '@/components/ConfirmModal';
import { useBoards } from '@/context/boards/BoardsContext';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils/cn';
import { UserRole } from '@/types/constants';

/** Eventos do pipeline que uma regra pode escutar */
type PipelineEvent = 'deal.created' | 'deal.stage_changed';

const PIPELINE_EVENTS: Array<{ key: PipelineEvent; label: string; hint: string }> = [
  {
    key: 'deal.created',
    label: 'Lead criado',
    hint: 'Dispara quando um negócio novo entra no quadro/etapa escolhidos (criado à mão, pelo webhook de entrada, pela API ou pelo WhatsApp).',
  },
  {
    key: 'deal.stage_changed',
    label: 'Lead mudou de etapa',
    hint: 'Dispara quando o lead é movido. Você pode filtrar a etapa de origem e a de destino.',
  },
];

/** Linha de integration_outbound_endpoints com kind = 'pipeline' */
type PipelineRuleRow = {
  id: string;
  name: string;
  url: string;
  secret: string;
  active: boolean;
  events: string[];
  board_id: string | null;
  from_stage_id: string | null;
  to_stage_id: string | null;
  created_at: string;
};

/** Quadro mínimo que a seção precisa (compatível com o Board do contexto) */
type BoardLike = { id: string; name: string; isDefault?: boolean; stages: Array<{ id: string; label: string }> };

/** Valor do select para "qualquer quadro/etapa" */
const ANY = '';

/** Mesma geração de segredo da WebhooksSection (base64url de 24 bytes) */
function generateSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return b64;
}

function isValidUrl(url: string) {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

/** Texto humano do gatilho da regra (ex.: "Lead criado em Vendas › Novo lead") */
function describeRule(rule: PipelineRuleRow, boards: BoardLike[]): string {
  const board = rule.board_id ? boards.find((b) => b.id === rule.board_id) : undefined;
  const boardName = board?.name;
  const stageLabel = (stageId: string | null): string | null => {
    if (!stageId) return null;
    for (const b of boards) {
      const s = b.stages?.find((x) => x.id === stageId);
      if (s) return s.label;
    }
    return 'etapa removida';
  };
  const event = rule.events?.[0];
  const to = stageLabel(rule.to_stage_id);
  const from = stageLabel(rule.from_stage_id);
  const boardSuffix = boardName ? ` (${boardName})` : '';

  if (event === 'deal.created') {
    if (boardName && to) return `Lead criado em ${boardName} › ${to}`;
    if (boardName) return `Lead criado em ${boardName} (qualquer etapa)`;
    return 'Lead criado (qualquer quadro)';
  }
  if (from && to) return `Lead saiu de ${from} para ${to}${boardSuffix}`;
  if (to) return `Lead entrou na etapa ${to}${boardSuffix}`;
  if (from) return `Lead saiu da etapa ${from}${boardSuffix}`;
  if (boardName) return `Lead mudou de etapa em ${boardName}`;
  return 'Lead mudou de etapa (qualquer)';
}

/** Exemplos de payload para o usuário montar o fluxo no n8n/Make */
const EXAMPLE_CREATED = JSON.stringify(
  {
    event_type: 'deal.created',
    occurred_at: '2026-08-26T13:00:00+00:00',
    deal: {
      id: 'uuid-do-negocio',
      title: 'Contrato Anual - Acme',
      value: 12000,
      board_id: 'uuid-do-quadro',
      board_name: 'Vendas',
      stage_id: 'uuid-da-etapa',
      stage_label: 'Novo lead',
      contact_id: 'uuid-do-contato',
      custom_fields: {},
      created_at: '2026-08-26T13:00:00+00:00',
    },
    contact: { name: 'Nome do Contato', phone: '+5511999999999', email: 'email@exemplo.com' },
    rule: { id: 'uuid-da-regra', name: 'Novo lead → n8n', kind: 'pipeline' },
  },
  null,
  2
);

const EXAMPLE_STAGE_CHANGED = JSON.stringify(
  {
    event_type: 'deal.stage_changed',
    occurred_at: '2026-08-26T13:00:00+00:00',
    deal: {
      id: 'uuid-do-negocio',
      title: 'Contrato Anual - Acme',
      value: 12000,
      board_id: 'uuid-do-quadro',
      board_name: 'Vendas',
      from_stage_id: 'uuid-da-etapa-origem',
      from_stage_label: 'Qualificação',
      to_stage_id: 'uuid-da-etapa-destino',
      to_stage_label: 'Proposta enviada',
      contact_id: 'uuid-do-contato',
    },
    contact: { name: 'Nome do Contato', phone: '+5511999999999', email: 'email@exemplo.com' },
    rule: { id: 'uuid-da-regra', name: 'Proposta enviada → n8n', kind: 'pipeline' },
  },
  null,
  2
);

const inputClass =
  'w-full px-4 py-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 dark:text-white disabled:opacity-60';
const labelClass = 'text-xs font-bold text-slate-600 dark:text-slate-300';
const secondaryBtnClass =
  'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-60';
const copyBtnClass =
  'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors';

/**
 * Componente React `PipelineWebhooksSection`.
 * Regras de webhook do pipeline (várias por organização, cada uma com sua URL):
 * lead criado numa etapa / lead mudou de etapa -> POST para n8n, Make etc.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const PipelineWebhooksSection: React.FC = () => {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { boards, loading: boardsLoading } = useBoards();

  const canUse =
    (profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN) && !!profile?.organization_id;

  const [rules, setRules] = useState<PipelineRuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modal de criar/editar
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<PipelineRuleRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formEvent, setFormEvent] = useState<PipelineEvent>('deal.created');
  const [formBoardId, setFormBoardId] = useState<string>(ANY);
  const [formFromStageId, setFormFromStageId] = useState<string>(ANY);
  const [formToStageId, setFormToStageId] = useState<string>(ANY);
  const [formUrl, setFormUrl] = useState('');

  // Exclusão
  const [ruleToDelete, setRuleToDelete] = useState<PipelineRuleRow | null>(null);

  const formBoard = useMemo(() => boards.find((b) => b.id === formBoardId) || null, [boards, formBoardId]);
  const formStages = formBoard?.stages || [];
  const formEventMeta = PIPELINE_EVENTS.find((ev) => ev.key === formEvent);

  async function loadRules() {
    if (!canUse) return;
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('integration_outbound_endpoints')
        .select('id,name,url,secret,active,events,board_id,from_stage_id,to_stage_id,created_at')
        .eq('organization_id', profile!.organization_id)
        .eq('kind', 'pipeline')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setRules((data as any) || []);
    } catch (e: any) {
      addToast(e?.message || 'Erro ao carregar regras do pipeline', 'error');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!canUse) return;
    if (!supabase) return;
    loadRules();
  }, [canUse]);

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  }

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormEvent('deal.created');
    setFormBoardId(ANY);
    setFormFromStageId(ANY);
    setFormToStageId(ANY);
    setFormUrl('');
    setIsFormOpen(true);
  }

  function openEdit(rule: PipelineRuleRow) {
    setEditing(rule);
    setFormName(rule.name);
    setFormEvent(rule.events?.[0] === 'deal.stage_changed' ? 'deal.stage_changed' : 'deal.created');
    setFormBoardId(rule.board_id || ANY);
    setFormFromStageId(rule.from_stage_id || ANY);
    setFormToStageId(rule.to_stage_id || ANY);
    setFormUrl(rule.url);
    setIsFormOpen(true);
  }

  /** Trocar o quadro limpa as etapas escolhidas (elas pertencem ao quadro anterior) */
  function handleBoardChange(nextBoardId: string) {
    setFormBoardId(nextBoardId);
    setFormFromStageId(ANY);
    setFormToStageId(ANY);
  }

  function handleEventChange(next: PipelineEvent) {
    setFormEvent(next);
    // "De" só existe em "mudou de etapa"
    if (next === 'deal.created') setFormFromStageId(ANY);
  }

  const sameFromTo =
    formEvent === 'deal.stage_changed' && formFromStageId !== ANY && formFromStageId === formToStageId;
  const canSave = !loading && formName.trim().length > 0 && isValidUrl(formUrl) && !sameFromTo;

  async function handleSave() {
    if (!canUse) return;
    if (!canSave) return;

    const boardId = formBoardId || null;
    const values = {
      name: formName.trim(),
      url: formUrl.trim(),
      events: [formEvent],
      board_id: boardId,
      from_stage_id: formEvent === 'deal.stage_changed' && boardId ? formFromStageId || null : null,
      to_stage_id: boardId ? formToStageId || null : null,
    };

    setLoading(true);
    try {
      if (editing?.id) {
        const { error } = await supabase.from('integration_outbound_endpoints').update(values).eq('id', editing.id);
        if (error) throw error;
        addToast('Regra atualizada!', 'success');
      } else {
        const { error } = await supabase.from('integration_outbound_endpoints').insert({
          organization_id: profile!.organization_id,
          kind: 'pipeline',
          secret: generateSecret(),
          active: true,
          ...values,
        });
        if (error) throw error;
        addToast('Regra criada! Copie o segredo e valide no seu n8n/Make.', 'success');
      }
      setIsFormOpen(false);
      await loadRules();
    } catch (e: any) {
      addToast(e?.message || 'Erro ao salvar regra', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(rule: PipelineRuleRow) {
    if (!canUse) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('integration_outbound_endpoints')
        .update({ active: !rule.active })
        .eq('id', rule.id);
      if (error) throw error;
      addToast(!rule.active ? 'Regra ativada!' : 'Regra desativada.', 'success');
      await loadRules();
    } catch (e: any) {
      addToast(e?.message || 'Erro ao atualizar regra', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!canUse) return;
    if (!ruleToDelete?.id) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('integration_outbound_endpoints').delete().eq('id', ruleToDelete.id);
      if (error) throw error;
      addToast('Regra removida.', 'success');
      setRuleToDelete(null);
      await loadRules();
    } catch (e: any) {
      addToast(e?.message || 'Erro ao excluir regra', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsSection title="Automações do pipeline (webhooks)" icon={Workflow}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
        Avise o n8n, Make ou qualquer sistema quando um lead for criado ou mudar de etapa. Cada regra tem sua própria
        URL e segredo.
      </p>

      {!canUse ? (
        <div className="p-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-600 dark:text-slate-300">
          Disponível apenas para administradores.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {rules.length === 0
                ? 'Nenhuma regra criada ainda.'
                : `${rules.length} ${rules.length === 1 ? 'regra' : 'regras'} · ${rules.filter((r) => r.active).length} ativa(s)`}
            </div>
            <button
              type="button"
              onClick={openCreate}
              disabled={loading || boardsLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-4 w-4" />
              Nova regra
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="p-6 bg-white dark:bg-white/5 border border-dashed border-slate-300 dark:border-white/15 rounded-2xl text-center">
              <div className="text-sm font-bold text-slate-900 dark:text-white">Nenhuma regra ainda</div>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-md mx-auto">
                Exemplo: quando um lead cair na etapa “Proposta enviada”, avisar o n8n para mandar a proposta por
                WhatsApp.
              </p>
              <button
                type="button"
                onClick={openCreate}
                disabled={loading || boardsLoading}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                Nova regra
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="p-5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">{rule.name}</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{describeRule(rule, boards)}</p>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <LinkIcon className="h-4 w-4 shrink-0" />
                      <span className="font-mono truncate max-w-[520px]">{rule.url}</span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-bold px-2 py-1 rounded uppercase shrink-0',
                      rule.active
                        ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400'
                        : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                    )}
                  >
                    {rule.active ? 'Ativa' : 'Inativa'}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => copy(rule.url, `url-${rule.id}`)} className={copyBtnClass}>
                    <Copy className="h-4 w-4" />
                    Copiar URL
                    {copiedKey === `url-${rule.id}` && <Check className="h-4 w-4 text-green-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(rule.secret, `secret-${rule.id}`)}
                    className={copyBtnClass}
                  >
                    <KeyRound className="h-4 w-4" />
                    Copiar segredo
                    {copiedKey === `secret-${rule.id}` && <Check className="h-4 w-4 text-green-600" />}
                  </button>
                  <button type="button" onClick={() => openEdit(rule)} disabled={loading} className={secondaryBtnClass}>
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(rule)}
                    disabled={loading}
                    className={secondaryBtnClass}
                  >
                    <Power className="h-4 w-4" />
                    {rule.active ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRuleToDelete(rule)}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-white dark:bg-white/5 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Como o aviso chega */}
          <details className="rounded-2xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-white">
              Como o aviso chega (para montar o fluxo no n8n/Make)
            </summary>
            <div className="mt-3 space-y-4 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              <div>
                Fazemos um <b>POST</b> com JSON na URL da regra. O segredo vai nos headers{' '}
                <code className="font-mono">X-Webhook-Secret</code> e{' '}
                <code className="font-mono">Authorization: Bearer &lt;segredo&gt;</code> — valide um deles no seu
                lado. O header <code className="font-mono">X-Webhook-Event</code> traz o nome do evento. Se o destino
                falhar, tentamos de novo automaticamente (até 5 vezes, com intervalo crescente).
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className={labelClass}>Exemplo: lead criado (deal.created)</div>
                  <button
                    type="button"
                    onClick={() => copy(EXAMPLE_CREATED, 'exCreated')}
                    className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {copiedKey === 'exCreated' ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                    Copiar
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-xs p-3 rounded-lg bg-slate-900 text-slate-100 border border-slate-800 overflow-x-auto">
                  {EXAMPLE_CREATED}
                </pre>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className={labelClass}>Exemplo: lead mudou de etapa (deal.stage_changed)</div>
                  <button
                    type="button"
                    onClick={() => copy(EXAMPLE_STAGE_CHANGED, 'exStage')}
                    className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {copiedKey === 'exStage' ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                    Copiar
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-xs p-3 rounded-lg bg-slate-900 text-slate-100 border border-slate-800 overflow-x-auto">
                  {EXAMPLE_STAGE_CHANGED}
                </pre>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                Dica: no n8n, use o nó <b>Webhook</b> (método POST) e cole a URL gerada por ele aqui na regra. O campo{' '}
                <code className="font-mono">rule.name</code> ajuda a saber qual regra disparou quando várias apontam
                para o mesmo fluxo.
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Modal de criar/editar regra */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editing ? 'Editar regra' : 'Nova regra do pipeline'}
        size="lg"
        bodyClassName="max-h-[75vh] overflow-auto"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className={labelClass}>Nome da regra</label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ex.: Proposta enviada → n8n"
              className={inputClass}
            />
          </div>

          <div className="space-y-2">
            <label className={labelClass}>Quando</label>
            <select
              value={formEvent}
              onChange={(e) => handleEventChange(e.target.value as PipelineEvent)}
              className={inputClass}
            >
              {PIPELINE_EVENTS.map((ev) => (
                <option key={ev.key} value={ev.key}>
                  {ev.label}
                </option>
              ))}
            </select>
            {formEventMeta ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">{formEventMeta.hint}</div>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className={labelClass}>Quadro</label>
            <select
              value={formBoardId}
              onChange={(e) => handleBoardChange(e.target.value)}
              disabled={boardsLoading}
              className={inputClass}
            >
              <option value={ANY}>Qualquer quadro</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isDefault ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          </div>

          {formEvent === 'deal.created' ? (
            <div className="space-y-2">
              <label className={labelClass}>Etapa em que o lead foi criado</label>
              <select
                value={formToStageId}
                onChange={(e) => setFormToStageId(e.target.value)}
                disabled={!formBoard || formStages.length === 0}
                className={inputClass}
              >
                <option value={ANY}>Qualquer etapa</option>
                {formStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {!formBoard ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Escolha um quadro para filtrar por etapa.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className={labelClass}>De (etapa de origem)</label>
                  <select
                    value={formFromStageId}
                    onChange={(e) => setFormFromStageId(e.target.value)}
                    disabled={!formBoard || formStages.length === 0}
                    className={inputClass}
                  >
                    <option value={ANY}>Qualquer etapa</option>
                    {formStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Para (etapa de destino)</label>
                  <select
                    value={formToStageId}
                    onChange={(e) => setFormToStageId(e.target.value)}
                    disabled={!formBoard || formStages.length === 0}
                    className={inputClass}
                  >
                    <option value={ANY}>Qualquer etapa</option>
                    {formStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!formBoard ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Escolha um quadro para filtrar por etapa de origem/destino.
                </div>
              ) : null}
              {sameFromTo ? (
                <div className="text-xs text-red-600 dark:text-red-400">
                  A etapa de origem e a de destino precisam ser diferentes.
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <label className={labelClass}>URL do destino</label>
            <input
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://seu-n8n.com/webhook/..."
              className={inputClass}
            />
            {formUrl.trim() && !isValidUrl(formUrl) ? (
              <div className="text-xs text-red-600 dark:text-red-400">Informe uma URL começando com https://</div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Cole a URL do nó Webhook do n8n (ou do módulo do Make). O segredo é gerado automaticamente.
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {editing ? 'Salvar' : 'Criar regra'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!ruleToDelete}
        onClose={() => setRuleToDelete(null)}
        onConfirm={handleDelete}
        title="Excluir regra do pipeline?"
        message={
          <div>
            Isso remove apenas a <b>regra</b> “{ruleToDelete?.name}”. O CRM deixa de avisar essa URL; nada muda nos
            leads.
          </div>
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
    </SettingsSection>
  );
};
