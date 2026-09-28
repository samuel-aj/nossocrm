'use client';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { useMyActionPermissions } from '@/lib/permissions/useMyActionPermissions';
import { useOrgMembers } from '@/lib/query/hooks';
import ConfirmModal from '@/components/ConfirmModal';
import type { Activity, Deal, DealView } from '@/types';
import type { ChatTimelineProps, ComposerMode } from '@/features/whatsapp/DealWhatsAppChat';
import { leadHistoryKey } from './timelinePage';
import { useLeadHistory } from './useLeadHistory';
import { useLeadTimelineEntries } from './LeadTimeline';
import { ActivityComposer, NoteComposer, EMPTY_ACTIVITY_DRAFT, draftFromActivity, type ActivityDraft } from './LeadComposers';
import { PendingActivitiesStrip } from './PendingActivitiesStrip';
export type LeadConversationResult = { timeline: ChatTimelineProps; dialogs: React.ReactNode; openActivity: (activity: Activity) => void; refresh: () => Promise<unknown> };
type Draft = { note: string; activity: ActivityDraft; mode: ComposerMode };
const emptyDraft = (): Draft => ({ note: '', activity: { ...EMPTY_ACTIVITY_DRAFT }, mode: 'message' });
export function useLeadConversation({ deal, enabled = true }: { deal: Deal | DealView | null | undefined; enabled?: boolean }): LeadConversationResult {
  const { organizationId, profile } = useAuth();
  const client = useQueryClient();
  const crm = useCRM();
  const permissions = useMyActionPermissions(deal?.boardId);
  const { data: members = [] } = useOrgMembers();
  const belongsToOrg = !deal?.organizationId || deal.organizationId === organizationId;
  const query = useLeadHistory(organizationId, deal?.id, enabled && belongsToOrg);
  // QueryClient-scoped drafts survive panel unmounts and remain org+lead scoped.
  const draftKey = ['leadConversationDraft', organizationId ?? '', deal?.id ?? ''];
  const { data: draft } = useQuery<Draft>({ queryKey: draftKey, queryFn: emptyDraft, enabled: false, initialData: emptyDraft, gcTime: Infinity });
  const [, renderDraft] = useState(0);
  const setDraft = (patch: Partial<Draft>) => { client.setQueryData<Draft>(draftKey, old => ({ ...(old ?? emptyDraft()), ...patch })); renderDraft(n => n + 1); };
  const [deleting, setDeleting] = useState<{ key: string; id: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [scrollKey, setScrollKey] = useState(0);
  const identity = `${organizationId}:${deal?.id}`;
  const error = failure?.key === identity ? failure.message : null;
  const setError = (message: string) => setFailure({ key: identity, message });
  const currentIdentity = useRef(identity);
  useLayoutEffect(() => { currentIdentity.current = identity; }, [identity]);
  const canEdit = enabled && belongsToOrg && !!deal && !!organizationId && permissions.deals.edit;
  const refresh = async () => client.invalidateQueries({ queryKey: leadHistoryKey(organizationId ?? '', deal?.id ?? '') });
  const afterSave = async () => { await client.invalidateQueries({ queryKey: leadHistoryKey(organizationId ?? '', deal?.id ?? '') }); if (currentIdentity.current === identity) setScrollKey(n => n + 1); };
  const openActivity = (activity: Activity) => { setDraft({ activity: draftFromActivity(activity), mode: 'activity' }); };
  const toggle = (a: Activity) => {
    if (!canEdit) return;
    void crm.updateActivity(a.id, { completed: !a.completed }, { throwOnError: true }).then(refresh).catch(e => currentIdentity.current === identity && setError(e.message));
  };
  const saveNote = async (text: string) => {
    if (!canEdit || !deal) throw new Error('Sem permissão para editar');
    const saved = await crm.addActivity({ dealId: deal.id, dealTitle: deal.title, type: 'NOTE', title: 'Nota interna', description: text, date: new Date().toISOString(), completed: true, user: { name: profile?.name ?? 'Usuário', avatar: profile?.avatar_url ?? '' } });
    if (!saved) throw new Error('Não foi possível salvar a nota. O texto continua aqui.');
    await afterSave();
  };
  const saveActivity = async (value: ActivityDraft) => {
    if (!canEdit || !deal) throw new Error('Sem permissão para editar');
    const changes = { title: value.title.trim(), description: value.description, type: value.type, date: new Date(`${value.date}T${value.time}`).toISOString() };
    if (value.editingId) await crm.updateActivity(value.editingId, changes, { throwOnError: true });
    else if (!await crm.addActivity({ ...changes, dealId: deal.id, dealTitle: deal.title, completed: false, user: { name: profile?.name ?? 'Usuário', avatar: profile?.avatar_url ?? '' } })) throw new Error('Não foi possível criar a atividade');
    const current = client.getQueryData<Draft>(draftKey);
    if (current?.activity === value) client.setQueryData(draftKey, { ...current, activity: { ...EMPTY_ACTIVITY_DRAFT } });
    await afterSave();
  };
  const memberName = useCallback((id: string) => members.find(m => m.id === id)?.name ?? null, [members]);
  const entries = useLeadTimelineEntries({ deal: deal ?? ({ createdAt: '' } as Deal), activities: query.activities, history: query.history, boards: crm.boards, memberName, customFields: crm.customFieldDefinitions, canEdit,
    onSaveNote: async (id, text) => { if (!canEdit) throw new Error('Sem permissão para editar'); await crm.updateActivity(id, { description: text }, { throwOnError: true }); await refresh(); },
    onDeleteNote: id => setDeleting({ key: identity, id }), onOpenActivity: openActivity, onToggleActivity: toggle });
  return {
    refresh, openActivity,
    timeline: {
      entries, historyLoadingOlder: query.isFetchingNextPage, composerMode: draft.mode, onComposerModeChange: mode => setDraft({ mode }), canWriteCrm: canEdit, scrollToEndKey: scrollKey,
      historyPrefix: <div className="text-center text-xs p-2" aria-live="polite">{query.isLoading && 'Carregando histórico…'}{query.isError && <p role="alert">Não foi possível carregar o histórico. <button onClick={() => void refresh()}>Tentar novamente</button></p>}{query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Carregando…' : 'Carregar histórico anterior'}</button>}</div>,
      aboveComposer: <>{error && <p role="alert">{error}</p>}<PendingActivitiesStrip activities={crm.activities.filter(a => a.dealId === deal?.id)} canEdit={canEdit} onOpen={openActivity} onComplete={toggle} isPending={crm.isActivityPending} /></>,
      noteComposer: <NoteComposer key={identity} value={draft.note} onChange={note => setDraft({ note })} onSave={saveNote} disabled={!canEdit} />,
      activityComposer: <ActivityComposer key={identity} draft={draft.activity} onChange={activity => setDraft({ activity })} onSubmit={saveActivity} onCancelEdit={() => setDraft({ activity: { ...EMPTY_ACTIVITY_DRAFT } })} disabled={!canEdit} onComplete={async id => { try { await crm.updateActivity(id, { completed: true }, { throwOnError: true }); await refresh(); } catch (e) { if (currentIdentity.current === identity) setError((e as Error).message); } }} />,
    },
    dialogs: <ConfirmModal isOpen={canEdit && deleting?.key === identity} onClose={() => setDeleting(null)} title="Excluir nota" message="Excluir esta nota interna? A exclusão fica registrada no histórico do lead." confirmText="Excluir" variant="danger" onConfirm={() => {
      if (!canEdit || deleting?.key !== identity) return;
      void crm.deleteActivity(deleting.id, { throwOnError: true }).then(async () => { if (currentIdentity.current === identity) setDeleting(null); await refresh(); }).catch(e => currentIdentity.current === identity && setError(e.message));
    }} />,
  };
}
