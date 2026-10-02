"use client";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import type { EntityType, GroupLinksTarget } from '@/lib/whatsapp/group-links/types';
import { groupLinksApi } from './api';

export const groupLinksKeys = {
  root: (org: string | null) => ['group-links', org] as const,
  settings: (org: string | null) => ['group-links', org, 'settings'] as const,
  relations: (org: string | null) => ['group-links', org, 'relations'] as const,
  target: (org: string | null, target: GroupLinksTarget) => ['group-links', org, 'relations', target] as const,
};
export function useGroupLinksFeature() {
  const { organizationId } = useAuth();
  const query = useQuery({ queryKey: groupLinksKeys.settings(organizationId), queryFn: groupLinksApi.settings, enabled: !!organizationId, staleTime: 0, refetchOnWindowFocus: 'always', retry: false });
  return { ...query, enabled: !!organizationId && query.isSuccess && query.data.enabled === true };
}
export function useSetGroupLinksEnabled() {
  const { organizationId } = useAuth();
  const client = useQueryClient();
  return useMutation({ mutationFn: groupLinksApi.setEnabled, onSuccess: async (data) => {
    await client.cancelQueries({ queryKey: groupLinksKeys.root(organizationId) });
    client.setQueryData(groupLinksKeys.settings(organizationId), data);
    await client.invalidateQueries({ queryKey: groupLinksKeys.relations(organizationId) });
    await client.invalidateQueries({ queryKey: [...groupLinksKeys.root(organizationId), 'options'] });
  } });
}
export function useGroupLinks(target: GroupLinksTarget) {
  const { organizationId } = useAuth();
  const feature = useGroupLinksFeature();
  const query = useQuery({ queryKey: groupLinksKeys.target(organizationId, target), queryFn: () => groupLinksApi.read(target), enabled: feature.enabled, staleTime: 0, retry: false });
  return { ...query, featureEnabled: feature.enabled && query.data?.enabled !== false };
}
export function useGroupLinkOptions(conversationId: string, type: EntityType, search: string, active: boolean) {
  const { organizationId } = useAuth();
  return useQuery({ queryKey: [...groupLinksKeys.root(organizationId), 'options', conversationId, type, search], queryFn: () => groupLinksApi.options(conversationId, type, search), enabled: active && !!organizationId, retry: false });
}
export function useMutateGroupLink() {
  const { organizationId } = useAuth();
  const client = useQueryClient();
  return useMutation({ mutationFn: groupLinksApi.mutate, onSuccess: () => client.invalidateQueries({ queryKey: groupLinksKeys.relations(organizationId) }) });
}
