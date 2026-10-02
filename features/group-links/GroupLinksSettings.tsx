"use client";
import { Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SettingsCard, SettingsRow } from '@/features/settings/components/SettingsUi';
import { useGroupLinksFeature, useSetGroupLinksEnabled } from './useGroupLinks';

export function GroupLinksSettings() {
  const { profile } = useAuth();
  const feature = useGroupLinksFeature();
  const mutation = useSetGroupLinksEnabled();
  if (profile?.role !== 'admin' && profile?.role !== 'super_admin') return null;
  return <SettingsCard title="Recursos opcionais" icon={Users}>
    <SettingsRow title="Vincular grupos a contatos e leads" description="Relacione o grupo da reunião de vendas aos contatos e leads e continue usando o mesmo grupo como cliente. Ao desativar, os vínculos e o ID ficam ocultos; os dados são preservados." control={
      <button type="button" role="switch" aria-label="Vincular grupos a contatos e leads" aria-checked={feature.enabled} disabled={!feature.isSuccess || mutation.isPending} onClick={() => mutation.mutate(!feature.enabled)} className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 focus-visible-ring ${feature.enabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${feature.enabled ? 'left-1 translate-x-5' : 'left-1'}`} />
      </button>
    } />
    {feature.isPending ? <p role="status" className="text-xs text-slate-500">Carregando configuração...</p> : null}
    {feature.isError || mutation.isError ? <p role="alert" className="text-xs text-red-600">{(mutation.error ?? feature.error)?.message} <button type="button" disabled={mutation.isPending} onClick={() => {
      if (mutation.isError && mutation.variables !== undefined) mutation.mutate(mutation.variables);
      else void feature.refetch();
    }} className="underline">Tentar novamente</button></p> : null}
    <p className="mt-3 text-xs text-slate-500">Desativado por padrão. Se os grupos não aparecerem nos Chats, ative também “Grupos do WhatsApp no chat” na tela Conexão. As duas opções são independentes.</p>
  </SettingsCard>;
}
