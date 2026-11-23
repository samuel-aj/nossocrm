'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/context/AuthContext';
import {deliverNotice,presentOnce,unlockNotificationSound} from '@/lib/notifications/delivery';
import type {Notice,NotificationFeed,NotificationSettings,Preferences} from '@/lib/notifications/types';
import { clearReadNotices, isOngoingNotice, reconcileUsageNotices } from '@/lib/notifications/history';

async function api<T>(url:string,init?:RequestInit):Promise<T> {
  const r=await fetch(url,{cache:'no-store',...init}); const data=await r.json();
  if(!r.ok) throw new Error(data.error || 'Não foi possível consultar os avisos.');
  return data;
}
export function usePersonalNotifications() {
  const {user,organizationId}=useAuth();
  const scope=user && organizationId ? `${organizationId}:${user.id}` : '';
  const router=useRouter(), client=useQueryClient();
  const queryKey=['personal-notification-settings',scope];
  const settings=useQuery({queryKey,enabled:!!scope,queryFn:()=>api<NotificationSettings>('/api/notifications/preferences'),staleTime:15_000,refetchInterval:60_000});
  const [history,setHistory]=useState<{scope:string;items:Notice[]}>({scope:'',items:[]});
  const [toast,setToast]=useState<{scope:string;notice:Notice}|null>(null);
  const [error,setError]=useState('');
  const seen=useRef(new Set<string>());
  const preferences=settings.data?.preferences;
  const fingerprint=JSON.stringify(preferences);
  useEffect(()=>{
    if(!scope || !preferences) return;
    const controller=new AbortController(); let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
    let running=false;
    let baseline:string|null=null;
    seen.current=new Set();
    // Cada consulta faz várias perguntas ao banco, em todas as abas abertas (antes era
    // a cada 4 s e pesou no banco em 23/11/2026): 15 s com a aba visível, 30 s com ela
    // escondida (o aviso com som continua chegando; presentOnce evita repetir entre
    // abas) e 60 s para quem desligou os avisos (só os alertas de conexão).
    const quiet=!preferences.messages && !preferences.leads && !preferences.alerts;
    const schedule=()=>{
      clearTimeout(timer); timer=undefined;
      if(stopped) return;
      const interval=quiet ? 60_000 : document.visibilityState==='hidden' ? 30_000 : 15_000;
      timer=setTimeout(()=>void poll(),interval);
    };
    const poll=async()=>{
      if(running || stopped) return;
      running=true;
      try {
        let after:string|null=null, until:string|null=null;
        let usageNoticesUnavailable = false;
        let connectionNoticesUnavailable = false;
        do {
          const firstPage = !after;
          const q=new URLSearchParams();
          if(baseline) q.set('since',new Date(Math.max(Date.parse(baseline),Date.now()-120_000)).toISOString());
          if(after) q.set('after',after);
          if(until) q.set('until',until);
          const data:NotificationFeed=await api(`/api/notifications/events?${q}`,{signal:controller.signal});
          if(stopped) return;
          until=data.serverTime; after=data.nextAfter;
          usageNoticesUnavailable ||= !!data.usageNoticesUnavailable;
          connectionNoticesUnavailable ||= !!data.connectionNoticesUnavailable;
          if(firstPage && !data.usageNoticesUnavailable && !data.connectionNoticesUnavailable) {
            setHistory(previous=>({scope,items:reconcileUsageNotices(previous.scope===scope ? previous.items : [],data.events)}));
            setToast(previous=>previous?.scope===scope && isOngoingNotice(previous.notice) && !data.events.some(n=>n.id===previous.notice.id) ? null : previous);
          }
          for(const notice of data.events) {
            if(seen.current.has(notice.id)) continue;
            seen.current.add(notice.id);
            if(seen.current.size>2000) seen.current.delete(seen.current.values().next().value!);
            setHistory(previous=>{
              const items=previous.scope===scope ? previous.items.filter(n=>n.id!==notice.id) : [];
              const ordinary=[notice,...items].filter(n=>!isOngoingNotice(n)).slice(0,30);
              const ongoing=[notice,...items].filter(isOngoingNotice);
              return {scope,items:[...ongoing,...ordinary]};
            });
            if(document.visibilityState==='visible') setToast({scope,notice});
            await presentOnce(scope,notice.id,()=>{if(!stopped) deliverNotice(notice,preferences,href=>router.push(href));});
          }
        } while(after && !stopped);
        baseline=until;
        setError(usageNoticesUnavailable ? 'Avisos de consumo da IA temporariamente indisponíveis. Tentando reconectar…'
          : connectionNoticesUnavailable ? 'Avisos de conexão temporariamente indisponíveis. Tentando reconectar…' : '');
      } catch { if(!stopped) setError('Avisos temporariamente indisponíveis. Tentando reconectar…'); }
      finally {running=false; schedule();}
    };
    void poll();
    // Voltou para a aba: consulta na hora em vez de esperar o intervalo de aba escondida
    const onVisibility=()=>{if(document.visibilityState==='visible' && !running){clearTimeout(timer); timer=undefined; void poll();}};
    document.addEventListener('visibilitychange',onVisibility);
    const unlock=()=>{if(preferences.sound) void unlockNotificationSound().catch(()=>{});};
    window.addEventListener('pointerdown',unlock); window.addEventListener('keydown',unlock);
    return()=>{stopped=true;controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);};
    // JSON fingerprint avoids restarting the baseline on equivalent refetches.
  },[scope,fingerprint,router]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),7000);return()=>clearTimeout(timer);},[toast]);
  async function save(p:Preferences) {
    const data=await api<NotificationSettings>('/api/notifications/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    client.setQueryData(queryKey,data);
    // Other tabs refetch immediately; no personal data is broadcast.
    try {localStorage.setItem(`crm-notification-settings:${scope}`,String(Date.now()));} catch { /* Settings were saved on the server. */ }
  }
  useEffect(()=>{
    const changed=(event:StorageEvent)=>{if(event.key===`crm-notification-settings:${scope}`) void client.invalidateQueries({queryKey:['personal-notification-settings',scope]});};
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
  },[scope,client]);
  function test(p:Preferences) {
    const notice:Notice={id:`test-${crypto.randomUUID()}`,kind:'message',title:'Teste de notificação',message:'Os avisos do CRM aparecem assim. Nenhuma mensagem foi enviada.',href:'/chats',createdAt:new Date().toISOString()};
    setToast({scope,notice});deliverNotice(notice,p,href=>router.push(href));
  }
  return {settings:settings.data,loading:settings.isLoading,error:settings.isError ? 'Não foi possível carregar suas preferências.' : error,save,test,
    notices:history.scope===scope ? history.items : [],toast:toast?.scope===scope ? toast.notice : null,
    dismiss:()=>setToast(null),clear:()=>setHistory(previous=>({scope,items:clearReadNotices(previous.scope===scope ? previous.items : [])}))};
}
