'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/context/AuthContext';
import {deliverNotice,presentOnce,unlockNotificationSound} from '@/lib/notifications/delivery';
import type {Notice,NotificationFeed,NotificationSettings,Preferences} from '@/lib/notifications/types';
import { clearReadNotices, isOngoingNotice, reconcileUsageNotices } from '@/lib/notifications/history';
import { receivesDevicePush } from '@/lib/notifications/pushDevice';
import { startNotificationPolling } from '@/lib/notifications/polling';
import { NOTIFICATION_FRESH_MS } from '@/lib/notifications/feedWindow';

async function api<T>(url:string,init?:RequestInit):Promise<T> {
  // Bound each HTTP request, not the whole batch: delivery may legitimately
  // wait for cross-tab locks between pages or for many background notices.
  const controller=new AbortController();
  const abort=()=>controller.abort(init?.signal?.reason);
  if(init?.signal?.aborted) abort();
  else init?.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Tempo de consulta excedido.','TimeoutError')),20_000);
  try {
    const r=await fetch(url,{cache:'no-store',...init,signal:controller.signal}); const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Não foi possível consultar os avisos.');
    return data;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort',abort);
  }
}
export function usePersonalNotifications() {
  const {user,organizationId}=useAuth();
  const scope=user && organizationId ? `${organizationId}:${user.id}` : '';
  const router=useRouter(), client=useQueryClient();
  const queryKey=['personal-notification-settings',scope];
  const settings=useQuery({queryKey,enabled:!!scope,queryFn:({signal})=>api<NotificationSettings>('/api/notifications/preferences',{signal}),staleTime:300_000,retry:1});
  const [history,setHistory]=useState<{scope:string;items:Notice[]}>({scope:'',items:[]});
  const [toast,setToast]=useState<{scope:string;notice:Notice}|null>(null);
  const [error,setError]=useState('');
  const session=useRef({scope:'',baseline:null as string|null,seen:new Set<string>()});
  const polling=useRef<ReturnType<typeof startNotificationPolling>|null>(null);
  const preferences=settings.data?.preferences;
  const fingerprint=JSON.stringify(preferences);
  useEffect(()=>{
    if(!scope || !preferences) return;
    let stopped=false;
    if(session.current.scope!==scope) session.current={scope,baseline:null,seen:new Set()};
    const current=session.current;
    const poll=async(signal:AbortSignal)=>{
      let projectionError='';
      try {
        const baseline=current.baseline;
        let after:string|null=null, until:string|null=null;
        let usageNoticesUnavailable = false;
        let connectionNoticesUnavailable = false;
        do {
          const firstPage = !after;
          const q=new URLSearchParams();
          if(baseline) q.set('since',baseline);
          if(after) q.set('after',after);
          if(until) q.set('until',until);
          const data:NotificationFeed=await api(`/api/notifications/events?${q}`,{signal});
          if(stopped || signal.aborted) return;
          until=data.serverTime; after=data.nextAfter;
          usageNoticesUnavailable ||= !!data.usageNoticesUnavailable;
          connectionNoticesUnavailable ||= !!data.connectionNoticesUnavailable;
          if(firstPage && !data.usageNoticesUnavailable && !data.connectionNoticesUnavailable) {
            setHistory(previous=>({scope,items:reconcileUsageNotices(previous.scope===scope ? previous.items : [],data.events)}));
            setToast(previous=>previous?.scope===scope && isOngoingNotice(previous.notice) && !data.events.some(n=>n.id===previous.notice.id) ? null : previous);
          }
          for(const notice of data.events) {
            if(current.seen.has(notice.id)) continue;
            current.seen.add(notice.id);
            if(current.seen.size>2000) current.seen.delete(current.seen.values().next().value!);
            setHistory(previous=>{
              const items=previous.scope===scope ? previous.items.filter(n=>n.id!==notice.id) : [];
              const ordinary=[notice,...items].filter(n=>!isOngoingNotice(n)).slice(0,30);
              const ongoing=[notice,...items].filter(isOngoingNotice);
              return {scope,items:[...ongoing,...ordinary]};
            });
            // Recover history after suspension without a burst of old sounds/banners.
            if(!isOngoingNotice(notice) && Date.parse(notice.createdAt)<Date.parse(data.serverTime)-NOTIFICATION_FRESH_MS) continue;
            // Keep it in the bell, but let this device's push deliver the sound/banner just once.
            if(notice.kind==='message' && user && organizationId && await receivesDevicePush({userId:user.id,organizationId})) continue;
            if(stopped || signal.aborted) return;
            if(document.visibilityState==='visible') setToast({scope,notice});
            await presentOnce(scope,notice.id,()=>{if(!stopped && !signal.aborted) deliverNotice(notice,preferences,href=>router.push(href));});
          }
        } while(after && !stopped && !signal.aborted);
        if(stopped || signal.aborted) return;
        current.baseline=until;
        projectionError=usageNoticesUnavailable ? 'Avisos de consumo da IA temporariamente indisponíveis. Tentando reconectar…'
          : connectionNoticesUnavailable ? 'Avisos de conexão temporariamente indisponíveis. Tentando reconectar…' : '';
        setError(projectionError);
        if(projectionError) throw new Error(projectionError);
      } catch(error) {
        if(!stopped && (!signal.aborted || signal.reason?.name==='TimeoutError')) setError(projectionError || 'Avisos temporariamente indisponíveis. Tentando reconectar…');
        throw error;
      }
    };
    const scheduler=startNotificationPolling(poll);
    polling.current=scheduler;
    const unlock=()=>{if(preferences.sound) void unlockNotificationSound().catch(()=>{});};
    window.addEventListener('pointerdown',unlock); window.addEventListener('keydown',unlock);
    return()=>{stopped=true;scheduler.stop();if(polling.current===scheduler)polling.current=null;window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);};
    // Equivalent refetches do not restart the loop. Preference changes retain this scope's cursor/seen IDs.
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
  function refresh() {
    if(!scope) return;
    polling.current?.refresh();
    // Fresh settings use the same query cache; opening the bell cannot create a polling loop.
    void client.fetchQuery({queryKey,queryFn:({signal})=>api<NotificationSettings>('/api/notifications/preferences',{signal}),staleTime:300_000}).catch(()=>{});
  }
  return {settings:settings.data,loading:settings.isLoading,error:settings.isError ? 'Não foi possível carregar suas preferências.' : error,save,test,
    refresh,
    notices:history.scope===scope ? history.items : [],toast:toast?.scope===scope ? toast.notice : null,
    dismiss:()=>setToast(null),clear:()=>setHistory(previous=>({scope,items:clearReadNotices(previous.scope===scope ? previous.items : [])}))};
}
