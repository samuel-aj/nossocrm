import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { readTabOrg } from '@/lib/tabOrg';
import { queryKeys } from '@/lib/query/queryKeys';
import { patchConversationCache } from '@/lib/whatsapp/conversationCache';

type ConversationLink = {
  id: string; contact_id: string | null; deal_id: string | null;
  deal_link_mode?: string; is_group?: boolean | null; label_ids?: string[] | null;
};

/** A single idempotent repair for the open chat. Groups and manual choices never auto-link. */
export function useConversationLead(conversation: ConversationLink | null) {
  const client = useQueryClient();
  const { profile } = useAuth();
  const org = readTabOrg()?.id ?? profile?.organization_id;
  return useQuery({
    queryKey: ['waConversationLink', org, conversation?.id, conversation?.contact_id],
    enabled: !!org && !!conversation?.contact_id && !conversation.is_group && !conversation.deal_id && conversation.deal_link_mode !== 'manual',
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    queryFn: async ({ signal }) => {
      const tabOrg = readTabOrg()?.id;
      const res = await fetch(`/api/whatsapp/conversations/${conversation!.id}/resolve-lead`, {
        method: 'POST', credentials: 'include', signal,
      });
      const body = await res.json() as { conversation?: ConversationLink; error?: string };
      if (signal.aborted || readTabOrg()?.id !== tabOrg) throw new Error('Consulta cancelada');
      if (!res.ok || !body.conversation) throw new Error(body.error || 'Não foi possível consultar o vínculo.');
      const resolved = body.conversation;
      // Cancel older list requests before applying the authoritative link response.
      await client.cancelQueries({ queryKey: ['waConversations'] });
      if (signal.aborted || readTabOrg()?.id !== tabOrg) throw new Error('Consulta cancelada');
      patchConversationCache(client, resolved.id, resolved);
      if (resolved.deal_id && resolved.deal_id !== conversation?.deal_id) {
        void client.invalidateQueries({ queryKey: queryKeys.deals.detail(resolved.deal_id) });
        void client.invalidateQueries({ queryKey: ['waLabels'] });
      }
      return resolved;
    },
  });
}
