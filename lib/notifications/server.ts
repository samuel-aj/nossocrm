import 'server-only';
import type { RequireOrgResult } from '@/lib/whatsapp/api';
import { getTeamAccess, visibleLead } from '@/lib/permissions/teamAccessServer';
import { getVisibilityRules, connectionAllowed } from '@/lib/permissions/server';
import { DEFAULT_PREFERENCES, PreferencesSchema, type Preferences, type Notice } from './types';

interface MessageRow {id:string;conversation_id:string;wa_timestamp:string|null}
interface ConversationRow {id:string;contact_id:string|null;connection_id:string|null;wa_name:string|null;wa_phone:string;label_ids:string[]}
interface DealRow {id:string;title:string;board_id:string;owner_id:string|null;contact_id:string|null;is_won:boolean;is_lost:boolean;created_at:string}
type Auth = Extract<RequireOrgResult, {ok: true}>;
export async function context(auth: Auth) {
  const {admin, user: u} = auth;
  const [access,rules,boardResult,prefResult] = await Promise.all([
    getTeamAccess(admin,u.organizationId,u.id), getVisibilityRules(admin,u.organizationId,u.id,u.role),
    admin.from('boards').select('id,name').eq('organization_id',u.organizationId).is('deleted_at',null),
    admin.from('crm_notification_preferences').select('preferences').eq('organization_id',u.organizationId).eq('user_id',u.id).maybeSingle(),
  ]);
  if (boardResult.error) throw boardResult.error;
  if (prefResult.error) throw prefResult.error;
  const boards = (boardResult.data ?? []).filter(b =>
    (access.fullAccess || access.boards.some(r => r.boardId === b.id)) &&
    (!rules?.boards.board_ids || rules.boards.board_ids.includes(b.id)));
  const parsed = PreferencesSchema.safeParse(prefResult.data?.preferences);
  const stored = parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  const preferences = {...stored,boardIds:stored.boardIds.filter(id=>boards.some(b=>b.id===id))};
  return {access,rules,boards,preferences};
}
export async function saveSettings(auth: Auth, preferences: Preferences) {
  const ctx = await context(auth);
  if (preferences.boardIds.some(id => !ctx.boards.some(b => b.id === id))) throw new Error('Selecione apenas boards disponíveis.');
  const {error} = await auth.admin.from('crm_notification_preferences').upsert({
    organization_id:auth.user.organizationId,user_id:auth.user.id,preferences,updated_at:new Date().toISOString(),
  });
  if (error) throw error;
  return {...ctx,preferences};
}
export async function feed(auth: Auth, since: string | null, after: string | null, until: string | null) {
  const serverTime = new Date().toISOString();
  if (!since) return {events:[],serverTime,nextAfter:null};
  const ctx = await context(auth);
  const {preferences:p,access,rules} = ctx;
  if (!p.messages && !p.leads && !p.alerts) return {events:[],serverTime,nextAfter:null};
  const lower = new Date(Math.max(Date.parse(since),Date.now()-120_000)).toISOString();
  const upper = until && until < serverTime ? until : serverTime;
  let query = auth.admin.from('crm_notification_events').select('id,kind,source_id,board_id,created_at')
    .eq('organization_id',auth.user.organizationId).gte('created_at',lower).lte('created_at',upper).order('id').limit(200);
  if (after) query=query.gt('id',after);
  const {data: rows,error} = await query;
  if (error) throw error;
  const events=rows ?? [];
  const alertIds=events.filter(e=>e.kind==='alert' && p.alerts).map(e=>e.source_id);
  const alerts=alertIds.length ? await auth.admin.from('deal_alert_events').select('id,deal_id,message').eq('organization_id',auth.user.organizationId).in('id',alertIds).is('acknowledged_at',null) : {data:[],error:null};
  if(alerts.error) throw alerts.error;
  const alertDeals=alerts.data?.length ? await auth.admin.from('deals').select('id,title,board_id,owner_id,active_alert').eq('organization_id',auth.user.organizationId).in('id',alerts.data.map(a=>a.deal_id)).eq('owner_id',auth.user.id).is('deleted_at',null) : {data:[],error:null};
  if(alertDeals.error) throw alertDeals.error;
  const messageIds=events.filter(e=>e.kind==='message' && p.messages).map(e=>e.source_id);
  const leadIds=events.filter(e=>e.kind==='lead' && p.leads && p.boardIds.includes(e.board_id)).map(e=>e.source_id);
  const messages=messageIds.length ? await auth.admin.from('wa_messages').select('id,conversation_id,wa_timestamp').eq('organization_id',auth.user.organizationId).in('id',messageIds).eq('direction','in').is('deleted_at',null) : {data:[],error:null};
  if(messages.error) throw messages.error;
  const messageRows=(messages.data ?? []) as MessageRow[];
  const convIds=[...new Set(messageRows.map(m=>m.conversation_id))];
  const conversations=convIds.length ? await auth.admin.from('wa_conversations').select('id,contact_id,connection_id,wa_name,wa_phone,label_ids').eq('organization_id',auth.user.organizationId).in('id',convIds).eq('is_group',false) : {data:[],error:null};
  if(conversations.error) throw conversations.error;
  const conversationRows=(conversations.data ?? []) as ConversationRow[];
  const contactIds=[...new Set(conversationRows.map(c=>c.contact_id).filter(Boolean))];
  const [linked,leads]=await Promise.all([
    contactIds.length ? auth.admin.from('deals').select('id,title,board_id,owner_id,contact_id,is_won,is_lost,created_at').eq('organization_id',auth.user.organizationId).in('contact_id',contactIds).is('deleted_at',null).order('created_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    leadIds.length ? auth.admin.from('deals').select('id,title,board_id,owner_id,contact_id,is_won,is_lost,created_at').eq('organization_id',auth.user.organizationId).in('id',leadIds).is('deleted_at',null) : Promise.resolve({data:[],error:null}),
  ]);
  if(linked.error) throw linked.error;
  if(leads.error) throw leads.error;
  const linkedRows=(linked.data ?? []) as DealRow[];
  const leadRows=(leads.data ?? []) as DealRow[];
  const allowed = (d: {board_id:string;owner_id:string|null}) =>
    ctx.boards.some(b=>b.id===d.board_id) && visibleLead(access,auth.user.id,d.board_id,d.owner_id) &&
    (!rules || !d.owner_id || rules.deals.scope==='all' || d.owner_id===auth.user.id ||
      (rules.deals.scope==='team' && rules.deals.team_user_ids.includes(d.owner_id)));
  const notices:Notice[]=[];
  for(const event of events) {
    if(event.kind==='alert') {
      const a=(alerts.data as Array<{id:string;deal_id:string;message:string}> | null)?.find(a=>a.id===event.source_id);
      const d=(alertDeals.data as Array<{id:string;title:string;board_id:string;owner_id:string|null;active_alert:{id:string}|null}> | null)?.find(d=>d.id===a?.deal_id && d.active_alert?.id===a?.id);
      if(!p.alerts || !a || !d || d.owner_id!==auth.user.id || !allowed(d)) continue;
      notices.push({id:String(event.id),kind:'alert',title:'Alerta do lead',message:`${d.title} · ${a.message}`,href:`/boards?board=${d.board_id}&deal=${d.id}`,createdAt:event.created_at});
    } else if(event.kind==='lead') {
      const d=leadRows.find(d=>d.id===event.source_id);
      if(!d || !p.leads || !p.boardIds.includes(event.board_id) || d.board_id!==event.board_id || !allowed(d)) continue;
      notices.push({id:String(event.id),kind:'lead',title:'Novo lead no board',message:`${d.title} · ${ctx.boards.find(b=>b.id===d.board_id)?.name}`,href:`/boards?board=${d.board_id}&deal=${d.id}`,createdAt:event.created_at});
    } else {
      const m=messageRows.find(m=>m.id===event.source_id);
      // Synchronizing an old history must not produce fresh-message alerts.
      if(m?.wa_timestamp && Date.parse(m.wa_timestamp)<Date.parse(event.created_at)-120_000) continue;
      const c=conversationRows.find(c=>c.id===m?.conversation_id);
      if(!p.messages || !m || !c || !connectionAllowed(rules,c.connection_id)) continue;
      const labels=rules?.whatsapp.label_ids;
      if(labels && !labels.some(id=>(c.label_ids ?? []).includes(id))) continue;
      const ds=linkedRows.filter(d=>d.contact_id===c.contact_id);
      const effective=ds.find(d=>!d.is_won && !d.is_lost) ?? ds[0];
      if(!ds.some(allowed) || (p.scope==='own' && effective?.owner_id!==auth.user.id)) continue;
      const owners=rules?.whatsapp.owner_user_ids;
      if(owners && effective?.owner_id && effective.owner_id!==auth.user.id && !owners.includes(effective.owner_id)) continue;
      notices.push({id:String(event.id),kind:'message',title:'Nova mensagem de lead',message:c.wa_name || c.wa_phone || 'Abra a conversa para ler',href:`/chats?conversation=${c.id}`,createdAt:event.created_at});
    }
  }
  return {events:notices,serverTime:upper,nextAfter:events.length===200 ? String(events[events.length-1].id) : null};
}
