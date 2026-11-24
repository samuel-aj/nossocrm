import type { RequireOrgResult } from '@/lib/whatsapp/api';
import { connectionAllowed, filterConversationsByOwner, getVisibilityRules } from '@/lib/permissions/server';
import type { VisibilityRules } from '@/lib/permissions/types';
import type { Notice } from './types';

type Auth = Extract<RequireOrgResult, { ok: true }>;
type JournalEvent = { id: number | string; source_id: string; created_at: string };
type Review = {
  message_id: string; conversation_id: string; contact_id: string | null; connection_id: string | null;
  label_ids: string[]; owner_id: string | null; owner_role: string | null; reason: 'attempts_exhausted' | 'expired' | 'uncertain';
};

const reviewMessage: Record<Review['reason'], string> = {
  attempts_exhausted: 'As tentativas de iniciar o atendimento terminaram. Abra a conversa e confira a mensagem recebida.',
  expired: 'O prazo para iniciar o atendimento terminou. Abra a conversa e confira a mensagem recebida.',
  uncertain: 'O CRM não conseguiu confirmar o atendimento automático. Confira o histórico antes de responder.',
};

async function visibleReviews(auth: Auth, userId: string, rules: VisibilityRules | null, rows: Review[]) {
  const visible = rows.filter(row => connectionAllowed(rules, row.connection_id) &&
    (!rules?.whatsapp.label_ids || rules.whatsapp.label_ids.some(id => row.label_ids.includes(id))));
  if (!visible.length) return [];
  return filterConversationsByOwner(auth.admin, auth.user.organizationId, rules, userId, visible);
}

export async function entryRecoveryNotices(auth: Auth, rules: VisibilityRules | null, isAdmin: boolean, events: JournalEvent[]): Promise<Notice[]> {
  if (!events.length) return [];
  const { data, error } = await auth.admin.rpc('wa_entry_recovery_details', {
    p_org: auth.user.organizationId, p_user: auth.user.id, p_messages: events.map(event => event.source_id),
  });
  if (error) throw error;
  const reviews = (data ?? []) as Review[];
  const candidates = reviews.filter(row => isAdmin || row.owner_id === auth.user.id);
  const visible = await visibleReviews(auth, auth.user.id, rules, candidates);
  const assigned = new Map<string, Review[]>();
  for (const row of visible) {
    if (!row.owner_id || row.owner_id === auth.user.id) continue;
    const group = assigned.get(row.owner_id) ?? [];
    group.push(row);
    assigned.set(row.owner_id, group);
  }
  // An administrator covers a missing owner, including an owner who cannot
  // open this chat under their current board, owner, label or line permissions.
  const routedToOwner = new Set<string>();
  for (const [owner, rows] of assigned) {
    const ownerRules = await getVisibilityRules(auth.admin, auth.user.organizationId, owner, rows[0].owner_role ?? '');
    for (const row of await visibleReviews(auth, owner, ownerRules, rows)) routedToOwner.add(row.message_id);
  }
  const addressed = new Map(visible.filter(row => !routedToOwner.has(row.message_id)).map(row => [row.message_id, row]));
  return events.flatMap(event => {
    const row = addressed.get(event.source_id);
    if (!row) return [];
    return [{ id: String(event.id), kind: 'alert', tone: 'red', title: 'Atendimento pendente no WhatsApp',
      message: reviewMessage[row.reason], href: `/chats?conversation=${row.conversation_id}`, createdAt: event.created_at }];
  });
}
