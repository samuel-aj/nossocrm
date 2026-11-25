'use client';

/**
 * Painel "Dúvidas sem resposta" (aba Conhecimento do agente): perguntas que o
 * agente registrou com registrar_duvida_sem_resposta. Responder inclui a
 * resposta como trecho extra do documento escolhido; Ignorar, Reabrir, Tirar
 * da base e Excluir mudam o estado da dúvida.
 */
import React, { useId, useState } from 'react';
import { ExternalLink, Loader2, MessageCircleQuestion, Pencil, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { useToast } from '@/context/ToastContext';
import type { AgentDocumentRow } from '@/lib/wa-agents/types';
import {
  formatGapAgo,
  gapReappeared,
  isLearnedAnswersDocument,
  GAP_ANSWER_MAX,
  GAP_QUESTION_MAX,
  LEARNED_DOCUMENT_TITLE,
  type KnowledgeGapAction,
  type KnowledgeGapRow,
  type KnowledgeGapStatus,
} from '@/lib/wa-agents/knowledgeGapsShared';
import { useDeleteKnowledgeGap, useKnowledgeGapAction, useWaAgentKnowledgeGaps } from './useWaAgents';
import {
  BTN_ICON,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  Badge,
  Drawer,
  EmptyState,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  Notice,
  Panel,
  SUBCARD_CLASS,
  Segmented,
  Spinner,
  TEXTAREA_CLASS,
  errorMessage,
} from './ui';

const NEW_DOCUMENT = '__novo_documento__';

const EMPTY_TEXT: Record<KnowledgeGapStatus, string> = {
  open: 'Nenhuma dúvida aberta. Quando o agente não souber responder algo, a pergunta aparece aqui.',
  included: 'Nenhuma resposta incluída ainda.',
  ignored: 'Nenhuma dúvida ignorada.',
};

type Editing = { gap: KnowledgeGapRow; mode: 'include' | 'edit' };

function documentLabel(doc: AgentDocumentRow): string {
  return (doc.title ?? '').trim() || doc.name;
}

function GapItem({
  gap,
  busy,
  documentName,
  onAnswer,
  onIgnore,
  onReopen,
  onRemove,
  onDelete,
}: {
  gap: KnowledgeGapRow;
  busy: boolean;
  documentName: string | null;
  onAnswer: () => void;
  onIgnore: () => void;
  onReopen: () => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const reappeared = gapReappeared(gap);
  return (
    <li className={SUBCARD_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white break-words">{gap.question}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Perguntada {gap.occurrences}x · última {formatGapAgo(gap.last_seen_at)}
          </p>
          {gap.test_only || reappeared || gap.last_conversation_id ? (
            <div className="flex flex-wrap items-center gap-2">
              {gap.test_only ? <Badge tone="slate">Só no teste</Badge> : null}
              {reappeared ? <Badge tone="amber">Perguntada de novo depois de incluída</Badge> : null}
              {gap.last_conversation_id ? (
                <a
                  href={`/chats?conversation=${gap.last_conversation_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Ver conversa
                </a>
              ) : null}
            </div>
          ) : null}
          {gap.status === 'included' && gap.answer ? (
            <div className="pt-1">
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{gap.answer}</p>
              <p className={HELP_CLASS}>{documentName ? `No documento ${documentName}` : 'Documento de destino não encontrado'}</p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
          {gap.status === 'open' ? (
            <>
              <button type="button" className={BTN_SMALL} onClick={onAnswer} disabled={busy}>
                Responder
              </button>
              <button type="button" className={BTN_SMALL} onClick={onIgnore} disabled={busy}>
                Ignorar
              </button>
            </>
          ) : null}
          {gap.status === 'included' ? (
            <>
              <button type="button" className={BTN_SMALL} onClick={onAnswer} disabled={busy}>
                <Pencil size={14} aria-hidden="true" />
                Editar
              </button>
              <button type="button" className={BTN_SMALL} onClick={onRemove} disabled={busy}>
                <Undo2 size={14} aria-hidden="true" />
                Tirar da base
              </button>
            </>
          ) : null}
          {gap.status === 'ignored' ? (
            <button type="button" className={BTN_SMALL} onClick={onReopen} disabled={busy}>
              <RotateCcw size={14} aria-hidden="true" />
              Reabrir
            </button>
          ) : null}
          {gap.status !== 'included' ? (
            <button
              type="button"
              className={BTN_ICON}
              onClick={onDelete}
              disabled={busy}
              aria-label={`Excluir dúvida: ${gap.question}`}
              title="Excluir"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AnswerDrawer({
  editing,
  documents,
  pending,
  onClose,
  onSubmit,
}: {
  editing: Editing;
  documents: AgentDocumentRow[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (action: KnowledgeGapAction) => void;
}) {
  const formId = useId();
  const { gap, mode } = editing;
  const ready = documents.filter((d) => d.status === 'ready');
  const canCreate = !documents.some(isLearnedAnswersDocument);
  const initialDestination =
    [gap.document_id, gap.suggested_document_id].find((id) => !!id && ready.some((d) => d.id === id)) ??
    ready[0]?.id ??
    (canCreate ? NEW_DOCUMENT : '');
  const [question, setQuestion] = useState(gap.question);
  const [answer, setAnswer] = useState(gap.answer ?? gap.suggested_answer ?? '');
  const [destination, setDestination] = useState<string>(initialDestination);
  const valid = question.trim().length >= 3 && answer.trim().length > 0 && destination !== '';

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!valid || pending) return;
    const target = destination === NEW_DOCUMENT ? { create_document: true as const } : { document_id: destination };
    onSubmit({ action: mode, question: question.trim(), answer: answer.trim(), ...target });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={mode === 'edit' ? 'Editar resposta' : 'Responder dúvida'}
      description="A resposta vira um trecho do documento escolhido e o agente passa a usá-la na próxima mensagem."
    >
      <form id={formId} onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <Field label="Pergunta" htmlFor={`${formId}-pergunta`}>
          <textarea
            id={`${formId}-pergunta`}
            className={TEXTAREA_CLASS}
            rows={2}
            value={question}
            maxLength={GAP_QUESTION_MAX}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </Field>
        {gap.context ? (
          <div>
            <p className={LABEL_CLASS}>O que o agente encontrou</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{gap.context}</p>
          </div>
        ) : null}
        <Field
          label="Resposta"
          htmlFor={`${formId}-resposta`}
          help={mode === 'include' && gap.suggested_answer ? 'Rascunho do agente: revise antes de incluir.' : undefined}
        >
          <textarea
            id={`${formId}-resposta`}
            className={TEXTAREA_CLASS}
            rows={8}
            value={answer}
            maxLength={GAP_ANSWER_MAX}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </Field>
        <Field label="Documento de destino" htmlFor={`${formId}-destino`}>
          <NativeSelect id={`${formId}-destino`} className={INPUT_CLASS} value={destination} onChange={(e) => setDestination(e.target.value)}>
            {documents.map((d) => (
              <option key={d.id} value={d.id} disabled={d.status !== 'ready'}>
                {`${documentLabel(d)}${d.status === 'processing' ? ' (processando)' : d.status === 'error' ? ' (com erro)' : ''}`}
              </option>
            ))}
            {canCreate ? <option value={NEW_DOCUMENT}>{`Novo documento: ${LEARNED_DOCUMENT_TITLE}`}</option> : null}
          </NativeSelect>
        </Field>
        {destination === '' ? (
          <Notice tone="amber">Nenhum documento pronto. Aguarde o processamento terminar ou envie um documento na Base de conhecimento.</Notice>
        ) : null}
      </form>
      <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-white/10 p-4">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={pending}>
          Cancelar
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={() => submit()} disabled={!valid || pending}>
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          {mode === 'edit' ? 'Salvar resposta' : 'Incluir na base'}
        </button>
      </div>
    </Drawer>
  );
}

export const KnowledgeGapsPanel: React.FC<{
  /** Agente salvo; null enquanto o agente novo não foi salvo */
  agentId: string | null;
  /** Opção "Aprender com dúvidas sem resposta" ligada no formulário */
  enabled: boolean;
  /** Documentos do agente (destino da resposta) */
  documents: AgentDocumentRow[];
  /** Abre a aba Ações e recursos, onde fica a opção */
  onOpenSettings: () => void;
}> = ({ agentId, enabled, documents, onOpenSettings }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<KnowledgeGapStatus>('open');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeGapRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const gapsQ = useWaAgentKnowledgeGaps(agentId, status);
  const act = useKnowledgeGapAction(agentId);
  const remove = useDeleteKnowledgeGap(agentId);

  if (!agentId) return null;

  const counts = gapsQ.data?.counts ?? { open: 0, included: 0, ignored: 0 };
  const total = counts.open + counts.included + counts.ignored;
  const gaps = gapsQ.data?.gaps ?? [];
  const documentName = (id: string | null) => {
    const doc = documents.find((d) => d.id === id);
    return doc ? documentLabel(doc) : null;
  };

  const run = async (gap: KnowledgeGapRow, action: KnowledgeGapAction, okMessage: string) => {
    setBusyId(gap.id);
    try {
      await act.mutateAsync({ gapId: gap.id, action });
      showToast(okMessage, 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Não foi possível atualizar a dúvida'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteConfirmed = () => {
    const gap = confirmDelete;
    setConfirmDelete(null);
    if (!gap) return;
    setBusyId(gap.id);
    remove
      .mutateAsync(gap.id)
      .then(
        () => showToast('Dúvida excluída', 'success'),
        (err) => showToast(errorMessage(err, 'Não foi possível excluir a dúvida'), 'error')
      )
      .finally(() => setBusyId(null));
  };

  return (
    <Panel
      title="Dúvidas sem resposta"
      icon={<MessageCircleQuestion size={16} />}
      description="Perguntas que o agente não conseguiu responder. Responda e inclua na base para ele aprender."
      right={counts.open > 0 ? <Badge tone="amber">{counts.open === 1 ? '1 aberta' : `${counts.open} abertas`}</Badge> : undefined}
    >
      {!enabled && !gapsQ.isLoading && total === 0 ? (
        <EmptyState
          title="O agente ainda não registra dúvidas"
          description="Ligue “Aprender com dúvidas sem resposta” em Ações e recursos."
          action={
            <button type="button" className={BTN_SECONDARY} onClick={onOpenSettings}>
              Abrir Ações e recursos
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {!enabled ? (
            <Notice tone="amber">
              <span>A opção está desligada: o agente não registra dúvidas novas. </span>
              <button type="button" className="font-medium underline" onClick={onOpenSettings}>
                Abrir Ações e recursos
              </button>
            </Notice>
          ) : null}
          <Segmented<KnowledgeGapStatus>
            value={status}
            onChange={setStatus}
            ariaLabel="Filtrar dúvidas"
            options={[
              { value: 'open', label: `Abertas (${counts.open})` },
              { value: 'included', label: `Incluídas (${counts.included})` },
              { value: 'ignored', label: `Ignoradas (${counts.ignored})` },
            ]}
          />
          {gapsQ.isLoading ? (
            <Spinner label="Carregando dúvidas..." />
          ) : gapsQ.error ? (
            <Notice tone="red">{errorMessage(gapsQ.error, 'Falha ao carregar as dúvidas')}</Notice>
          ) : gaps.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{EMPTY_TEXT[status]}</p>
          ) : (
            <ul className="space-y-2" aria-label="Dúvidas">
              {gaps.map((gap) => (
                <GapItem
                  key={gap.id}
                  gap={gap}
                  busy={busyId === gap.id}
                  documentName={documentName(gap.document_id)}
                  onAnswer={() => setEditing({ gap, mode: gap.status === 'included' ? 'edit' : 'include' })}
                  onIgnore={() => void run(gap, { action: 'ignore' }, 'Dúvida ignorada')}
                  onReopen={() => void run(gap, { action: 'reopen' }, 'Dúvida reaberta')}
                  onRemove={() => void run(gap, { action: 'remove' }, 'Resposta tirada da base')}
                  onDelete={() => setConfirmDelete(gap)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {editing ? (
        <AnswerDrawer
          key={`${editing.gap.id}:${editing.mode}`}
          editing={editing}
          documents={documents}
          pending={act.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(action) => {
            act.mutateAsync({ gapId: editing.gap.id, action }).then(
              () => {
                showToast(editing.mode === 'edit' ? 'Resposta salva' : 'Resposta incluída na base', 'success');
                setEditing(null);
              },
              (err) => showToast(errorMessage(err, 'Não foi possível salvar a resposta'), 'error')
            );
          }}
        />
      ) : null}

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={deleteConfirmed}
        title="Excluir dúvida?"
        message={confirmDelete ? `"${confirmDelete.question}" será apagada de vez.` : ''}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
    </Panel>
  );
};

export default KnowledgeGapsPanel;
