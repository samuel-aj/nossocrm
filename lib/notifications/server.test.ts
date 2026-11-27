import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('./connectionIncidents',()=>({connectionIncidentNotices:vi.fn(async()=>[])}));
vi.mock('@/lib/ai-usage/notifications',()=>({usageNotices:vi.fn()}));
vi.mock('@/lib/permissions/teamAccessServer',async()=>{
  const actual=await vi.importActual<typeof import('@/lib/permissions/teamAccessServer')>('@/lib/permissions/teamAccessServer');
  return {...actual,getTeamAccess:vi.fn()};
});
vi.mock('@/lib/permissions/server',async()=>{
  const actual=await vi.importActual<typeof import('@/lib/permissions/server')>('@/lib/permissions/server');
  return {...actual,getVisibilityRules:vi.fn()};
});
import {getTeamAccess} from '@/lib/permissions/teamAccessServer';
import {getVisibilityRules} from '@/lib/permissions/server';
import {DEFAULT_VISIBILITY_RULES} from '@/lib/permissions/types';
import {context,feed,saveSettings} from './server';
import {loadAuthorizedPushMessage} from './pushEligibility';
import {DEFAULT_PREFERENCES,PreferencesSchema} from './types';
import {usageNotices} from '@/lib/ai-usage/notifications';
import {connectionIncidentNotices} from './connectionIncidents';

const org='org-a',user='user-a';
let tables:Record<string,Record<string,unknown>[]>;
const queries:Array<{table:string;filters:Array<[string,unknown]>;ranges:Array<[string,string,unknown]>}>=[];
function from(table:string) {
  const filters:Array<[string,unknown]>=[],ranges:Array<[string,string,unknown]>=[];queries.push({table,filters,ranges});
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q;},is:()=>q,in:(k:string,v:unknown)=>{filters.push([k,v]);return q;},
    gte:(k:string,v:unknown)=>{ranges.push(['gte',k,v]);return q;},lte:(k:string,v:unknown)=>{ranges.push(['lte',k,v]);return q;},gt:(k:string,v:unknown)=>{ranges.push(['gt',k,v]);return q;},order:()=>q,limit:()=>q,
    maybeSingle:()=>Promise.resolve({data:tables[table]?.[0] ?? null,error:null}),
    upsert:vi.fn().mockResolvedValue({error:null}),
    then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:tables[table] ?? [],error:null}).then(resolve)};
  return q;
}
const rpc=vi.fn();
const auth={ok:true as const,user:{id:user,organizationId:org,role:'vendedor'},admin:{from,rpc}} as unknown as Parameters<typeof feed>[0];
const now=()=>new Date().toISOString();
it('delivers connection incidents to the bell even if personal lead alerts are disabled',async()=>{
  tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,alerts:false};
  const outage={id:'wa-line-1',kind:'alert' as const,category:'connection_outage' as const,title:'Falha na conexão do WhatsApp',message:'Linha A',href:'/conexao-whatsapp',createdAt:now()};
  vi.mocked(connectionIncidentNotices).mockResolvedValueOnce([outage]);
  expect((await feed(auth,null,null,null)).events).toEqual([outage]);
});
it('entrega a análise humana ao responsável, inclusive ao reabrir o CRM, respeitando canal e preferências', async () => {
  tables.crm_notification_events=[{id:7,kind:'human_handoff',source_id:'c',created_at:now()}];
  tables.wa_messages=[];
  expect((await notices())[0]).toMatchObject({id:'7',title:'Análise humana',href:'/chats?conversation=c'});
  expect((await feed(auth,null,null,null)).events).toHaveLength(1);
  tables.deals[0].owner_id='outro';
  expect(await notices()).toEqual([]);
  tables.deals=[];
  tables.wa_conversations[0].assigned_owner_id=user;
  expect(await notices()).toHaveLength(1);
  vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:[],label_ids:null,owner_user_ids:null}});
  expect(await notices()).toEqual([]);
  vi.mocked(getVisibilityRules).mockResolvedValue(null);
  tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,alerts:false};
  expect(await notices()).toEqual([]);
});
async function notices(){return (await feed(auth,now(),null,null)).events;}
beforeEach(()=>{
  queries.length=0;
  rpc.mockReset();
  vi.mocked(usageNotices).mockReset().mockResolvedValue([]);
  vi.mocked(getTeamAccess).mockResolvedValue({fullAccess:true,canManage:false,legacy:true,masterUserId:null,boards:[]});
  vi.mocked(getVisibilityRules).mockResolvedValue(null);
  tables={boards:[{id:'b',name:'Vendas'}],crm_notification_preferences:[{preferences:{...DEFAULT_PREFERENCES,messages:true,scope:'all',leads:true,boardIds:['11111111-1111-4111-8111-111111111111']}}],crm_notification_events:[{id:1,kind:'message',source_id:'m',created_at:now()}],wa_messages:[{id:'m',conversation_id:'c'}],wa_conversations:[{id:'c',contact_id:'contact',connection_id:'connection',wa_name:'Cliente',label_ids:[]}],deals:[{id:'d',title:'Lead',board_id:'b',owner_id:user,contact_id:'contact',is_won:false,is_lost:false}]};
});

describe('bounded recovery after a suspended notification poll',()=>{
  const current='2026-11-27T16:00:00.000Z';
  const journalQueries=()=>queries.filter(query=>query.table==='crm_notification_events');
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(current);});
  afterEach(()=>{vi.useRealTimers();});

  it('recovers from the last successful cursor after a five-minute interruption',async()=>{
    const since='2026-11-27T15:55:00.000Z';
    tables.crm_notification_events[0].created_at='2026-11-27T15:56:00.000Z';
    const result=await feed(auth,since,null,null);
    expect(result.events).toMatchObject([{id:'1',kind:'message'}]);
    expect(journalQueries()[0].ranges).toEqual([
      ['gte','created_at',since],['lte','created_at',current],
    ]);
    expect(journalQueries()[0].filters).toContainEqual(['organization_id',org]);
  });

  it('bounds a stale cursor to the previous 24 hours',async()=>{
    await feed(auth,'2026-11-20T16:00:00.000Z',null,null);
    expect(journalQueries()[0].ranges).toEqual([
      ['gte','created_at','2026-11-26T16:00:00.000Z'],['lte','created_at',current],
    ]);
  });

  it('keeps the same recovery window on later pages while the clock advances',async()=>{
    const since='2026-11-20T16:00:00.000Z';
    tables.crm_notification_events=Array.from({length:200},(_,i)=>({id:i+1,kind:'message',source_id:'m',created_at:current}));
    const first=await feed(auth,since,null,null);
    expect(first.nextAfter).toBe('200');
    vi.setSystemTime('2026-11-27T16:05:00.000Z');
    tables.crm_notification_events=[{id:201,kind:'message',source_id:'m',created_at:current}];
    const second=await feed(auth,since,first.nextAfter,first.serverTime);
    expect(second.serverTime).toBe(current);
    expect(second.nextAfter).toBeNull();
    expect(journalQueries()[1].ranges).toEqual([
      ...journalQueries()[0].ranges,['gt','id','200'],
    ]);
    expect(journalQueries().every(query=>query.filters.some(([key,value])=>key==='organization_id' && value===org))).toBe(true);
  });

  it('still starts a new session with only offline alerts instead of replaying messages',async()=>{
    tables.crm_notification_events=[
      {id:1,kind:'message',source_id:'m',created_at:current},
      {id:2,kind:'human_handoff',source_id:'c',created_at:current},
    ];
    const result=await feed(auth,null,null,null);
    expect(result.events).toMatchObject([{id:'2',kind:'alert',title:'Análise humana'}]);
    expect(journalQueries()[0].ranges).toEqual([
      ['gte','created_at','2026-11-26T16:00:00.000Z'],['lte','created_at',current],
    ]);
    expect(journalQueries()[0].filters).toContainEqual(['kind',['human_handoff','wa_entry_recovery','feedback']]);
  });
});

describe('WhatsApp entry recovery alerts',()=>{
  const adminAuth={...auth,user:{...auth.user,id:'admin',role:'admin'}};
  const review={message_id:'incoming',conversation_id:'chat-id',contact_id:null,connection_id:'line',label_ids:['team'],owner_id:user,owner_role:'vendedor',reason:'attempts_exhausted'};
  beforeEach(()=>{
    tables.crm_notification_events=[{id:19,source_id:'incoming',kind:'wa_entry_recovery',created_at:now()}];
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:false,alerts:true};
    tables.deals=[];
    rpc.mockResolvedValue({data:[review],error:null});
  });
  it('routes an assigned chat without a lead to the owner, including on boot, without contact data',async()=>{
    const first=(await feed(auth,null,null,null)).events;
    expect(first).toEqual([expect.objectContaining({id:'19',kind:'alert',tone:'red',title:'Atendimento pendente no WhatsApp',
      message:expect.stringContaining('tentativas'),href:'/chats?conversation=chat-id'})]);
    expect(await notices()).toEqual(first);
    expect(rpc).toHaveBeenCalledWith('wa_entry_recovery_details',{p_org:org,p_user:user,p_messages:['incoming']});
    expect((await feed(adminAuth,null,null,null)).events).toEqual([]);
  });
  it('routes an unassigned chat only to administrators and distinguishes uncertainty from exhaustion or expiration',async()=>{
    rpc.mockResolvedValue({data:[{...review,owner_id:null,owner_role:null,reason:'uncertain'}],error:null});
    expect(await notices()).toEqual([]);
    expect((await feed(adminAuth,null,null,null)).events).toMatchObject([{message:expect.stringContaining('confirmar'),href:'/chats?conversation=chat-id'}]);
    rpc.mockResolvedValue({data:[{...review,reason:'expired'}],error:null});
    expect(await notices()).toMatchObject([{message:expect.stringContaining('prazo')}]);
  });
  it('uses the administrator when the assigned seller cannot open a conversation without a lead',async()=>{
    vi.mocked(getTeamAccess).mockImplementation(async(_db,_org,id)=>({fullAccess:id==='admin',canManage:false,legacy:false,masterUserId:null,boards:[]}));
    expect(await notices()).toEqual([]);
    expect((await feed(adminAuth,null,null,null)).events).toMatchObject([{id:'19',href:'/chats?conversation=chat-id'}]);
  });
  it('checks WhatsApp visibility, alert preferences and the current queue projection before delivery',async()=>{
    vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:['other'],label_ids:null,owner_user_ids:null}});
    expect(await notices()).toEqual([]);
    vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:null,label_ids:['other'],owner_user_ids:null}});
    expect(await notices()).toEqual([]);
    vi.mocked(getVisibilityRules).mockResolvedValue(null);
    rpc.mockResolvedValue({data:[],error:null});
    expect(await notices()).toEqual([]);
    rpc.mockClear();
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,alerts:false};
    expect(await notices()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
describe('aviso do pedido de ajuste',()=>{
  const expected={id:'30',kind:'alert',tone:'green',title:'Seu pedido de ajuste',message:'Corrigido',href:'/suggestions?pedido=r1'};
  beforeEach(()=>{
    tables.crm_notification_events=[{id:30,kind:'feedback',source_id:'r1',created_at:now()}];
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:false,alerts:true};
    tables.feedback_requests=[{id:'r1',status:'corrigido',author_id:user}];
  });
  it('avisa quem enviou quando o status muda, inclusive ao reabrir o CRM',async()=>{
    expect(await notices()).toEqual([expect.objectContaining(expected)]);
    expect(queries.find(q=>q.table==='feedback_requests')?.filters).toEqual(expect.arrayContaining([['organization_id',org],['id',['r1']],['author_id',user]]));
    expect((await feed(auth,null,null,null)).events).toEqual([expect.objectContaining(expected)]);
    tables.feedback_requests[0].status='nao_e_bug';
    expect(await notices()).toMatchObject([{tone:'red',message:'Não é bug'}]);
  });
  it('não avisa outra pessoa nem quem desligou os alertas',async()=>{
    // A consulta filtra por author_id: para outra pessoa, o banco devolve lista vazia.
    tables.feedback_requests=[];
    expect(await notices()).toEqual([]);
    // Mesmo que a linha volte, o autor é conferido de novo antes do aviso.
    tables.feedback_requests=[{id:'r1',status:'corrigido',author_id:'outra-pessoa'}];
    expect(await notices()).toEqual([]);
    queries.length=0;
    tables.feedback_requests=[{id:'r1',status:'corrigido',author_id:user}];
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,alerts:false};
    expect(await notices()).toEqual([]);
    expect(queries.some(q=>q.table==='feedback_requests')).toBe(false);
  });
});
describe('personal notification security and audiences',()=>{
  const queued = { organization_id: org, user_id: user, event_id: '1', message_id: 'm' };
  it('reconfere o filtro de leads e a revogação de acesso entre a chegada e o push', async () => {
    rpc.mockResolvedValue({data:'vendedor',error:null});
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,scope:'own'};
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toEqual({conversationId:'c'});
    tables.deals[0].owner_id='colega';
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,scope:'all'};
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toEqual({conversationId:'c'});
    vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:[],label_ids:null,owner_user_ids:null}});
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
    rpc.mockResolvedValue({data:null,error:null});
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
  });
  it('não envia push de histórico importado ou de lead excluído', async () => {
    rpc.mockResolvedValue({data:'vendedor',error:null});
    tables.wa_messages[0].wa_timestamp=new Date(Date.now()-300_000).toISOString();
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
    expect(queries.find(q=>q.table==='crm_notification_events')?.filters).toEqual(expect.arrayContaining([
      ['organization_id',org],['id','1'],['source_id','m'],['kind','message'],
    ]));
    tables.wa_messages[0].wa_timestamp=now();
    tables.wa_conversations[0].created_at=new Date(Date.now()-86_400_000).toISOString();
    tables.deals=[];
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
  });
  it('aguarda o vínculo do primeiro atendimento e revalida o responsável antes do push', async () => {
    rpc.mockResolvedValue({data:'vendedor',error:null});
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,scope:'own'};
    const [lead] = tables.deals;
    tables.deals=[];
    const chat = tables.wa_conversations[0];
    chat.created_at=new Date(Date.now()-1000).toISOString();
    chat.contact_id=null;
    await expect(loadAuthorizedPushMessage(auth.admin,queued)).rejects.toThrow('aguarda o vínculo');
    chat.contact_id=lead.contact_id;
    tables.deals=[{...lead,owner_id:'outra-pessoa'}];
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
    tables.deals=[lead];
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toEqual({conversationId:'c'});
  });
  it('encerra a espera pelo lead e mantém o bloqueio de canais restritos desde a primeira tentativa', async () => {
    rpc.mockResolvedValue({data:'vendedor',error:null});
    tables.deals=[];
    tables.wa_conversations[0].created_at=new Date(Date.now()-1000).toISOString();
    vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:[],label_ids:null,owner_user_ids:null}});
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
    vi.mocked(getVisibilityRules).mockResolvedValue(null);
    const old=new Date(Date.now()-310_000).toISOString();
    tables.wa_conversations[0].created_at=old;
    tables.crm_notification_events[0].created_at=old;
    expect(await loadAuthorizedPushMessage(auth.admin,queued)).toBeNull();
  });
  it('entrega o aviso de áudio ao responsável mesmo com avisos de mensagens desligados',async()=>{
    tables.crm_notification_events[0].kind='audio_transcription';
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,alerts:true,messages:false};
    expect(await notices()).toEqual([expect.objectContaining({kind:'alert',tone:'red',title:'Áudio sem transcrição',href:'/chats?conversation=c'})]);
    tables.deals[0].owner_id='outro';
    expect(await notices()).toEqual([]);
  });
  it('defaults off and rejects arbitrary keys',async()=>{tables.crm_notification_preferences=[];expect((await context(auth)).preferences).toEqual(DEFAULT_PREFERENCES);expect(PreferencesSchema.safeParse({...DEFAULT_PREFERENCES,user_id:'other'}).success).toBe(false);expect(await notices()).toEqual([]);});
  it('keeps saved subscriptions when sound fields are missing',async()=>{const preferences=tables.crm_notification_preferences[0].preferences;delete preferences.soundType;delete preferences.volume;expect((await context(auth)).preferences).toMatchObject({messages:true,leads:true,scope:'all',soundType:'current',volume:40});});
  it('starts with a baseline without replaying old messages',async()=>{expect((await feed(auth,null,null,null)).events).toEqual([]);});
  it('links to the exact conversation and scopes every database read',async()=>{expect((await notices())[0].href).toBe('/chats?conversation=c');expect(queries.every(q=>q.filters.some(([k,v])=>k==='organization_id' && v===org))).toBe(true);expect(queries.find(q=>q.table==='crm_notification_preferences')?.filters).toContainEqual(['user_id',user]);});
  it('own scope excludes other owners',async()=>{tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,scope:'own'};tables.deals[0].owner_id='other';expect(await notices()).toEqual([]);});
  it('all scope still respects team board restrictions',async()=>{vi.mocked(getTeamAccess).mockResolvedValue({fullAccess:false,canManage:false,legacy:false,masterUserId:null,boards:[]});expect(await notices()).toEqual([]);});
  it('all scope respects legacy owner restrictions',async()=>{vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,deals:{scope:'own',team_user_ids:[]}});tables.deals[0].owner_id='other';expect(await notices()).toEqual([]);});
  it('respects WhatsApp connection and label restrictions',async()=>{vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:[],label_ids:null,owner_user_ids:null}});expect(await notices()).toEqual([]);vi.mocked(getVisibilityRules).mockResolvedValue({...DEFAULT_VISIBILITY_RULES,whatsapp:{connection_ids:null,label_ids:['private'],owner_user_ids:null}});expect(await notices()).toEqual([]);});
  it('does not notify contacts without a visible lead',async()=>{tables.deals=[];expect(await notices()).toEqual([]);});
  it('rejects subscriptions to inaccessible boards',async()=>{await expect(saveSettings(auth,{...DEFAULT_PREFERENCES,boardIds:['hidden']})).rejects.toThrow('boards disponíveis');});
  it('only emits lead events for selected, still-current boards',async()=>{const b='11111111-1111-4111-8111-111111111111';tables.boards=[{id:b,name:'Vendas'}];tables.deals[0].board_id=b;tables.crm_notification_events=[{id:2,kind:'lead',source_id:'d',board_id:b,created_at:now()}];expect((await notices())[0].href).toContain('deal=d');tables.deals[0].board_id='elsewhere';expect(await notices()).toEqual([]);});
});

it('delivers alerts independently to the current responsible seller only', async () => {
  tables.crm_notification_preferences=[{preferences:{...DEFAULT_PREFERENCES,messages:false,leads:false,alerts:true}}];
  tables.crm_notification_events=[{id:5,kind:'alert',source_id:'a',created_at:now()}];
  tables.deal_alert_events=[{id:'a',deal_id:'d',message:'Recuperado'}];
  tables.deals[0].active_alert={id:'a'};
  expect(await notices()).toMatchObject([{kind:'alert',tone:'green',message:'Lead · Recuperado',href:'/boards?board=b&deal=d'}]);
  tables.deal_alert_events[0].tone='red';
  expect(await notices()).toMatchObject([{kind:'alert',tone:'red'}]);
  tables.deals[0].owner_id='other';
  expect(await notices()).toEqual([]);
  tables.deals[0].owner_id=user;
  tables.deals[0].active_alert={id:'new'};
  expect(await notices()).toEqual([]);
});
it('suppresses recovery alerts outside board/lead visibility and when preference is off', async () => {
  tables.crm_notification_events=[{id:5,kind:'alert',source_id:'a',created_at:now()}];
  tables.deal_alert_events=[{id:'a',deal_id:'d',message:'Recuperado'}];
  tables.deals[0].active_alert={id:'a'};
  vi.mocked(getTeamAccess).mockResolvedValue({fullAccess:false,canManage:false,legacy:false,masterUserId:null,boards:[]});
  expect(await notices()).toEqual([]);
});

describe('durable usage alerts in the personal feed',()=>{
  const oldNotice={id:'ai-usage-old',kind:'alert' as const,title:'IA pausada por consumo',message:'Liberação manual necessária',href:'/chats?conversation=c',createdAt:'2026-09-01T10:00:00Z'};
  const enableAlerts=()=>{tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,alerts:true};};
  it('shows an old unresolved block on boot without replaying messages or leads',async()=>{
    enableAlerts();vi.mocked(usageNotices).mockResolvedValue([oldNotice]);
    const result=await feed(auth,null,null,null);
    expect(result.events).toEqual([oldNotice]);
    expect(result.nextAfter).toBeNull();
    expect(usageNotices).toHaveBeenCalledWith(auth.admin,auth.user,null,result.serverTime);
    expect(queries.find(q=>q.table==='crm_notification_events')?.filters).toContainEqual(['kind',['human_handoff','wa_entry_recovery','feedback']]);
    expect(queries.some(q=>q.table==='wa_messages')).toBe(false);
  });
  it('keeps unresolved alerts after an offline interval and uses stable IDs on repeated polls',async()=>{
    enableAlerts();vi.mocked(usageNotices).mockResolvedValue([oldNotice]);
    const first=await feed(auth,'2026-09-01T00:00:00Z',null,null);
    const second=await feed(auth,first.serverTime,null,null);
    expect(first.events.filter(n=>n.id.startsWith('ai-usage-'))).toEqual([oldNotice]);
    expect(second.events.filter(n=>n.id.startsWith('ai-usage-'))).toEqual([oldNotice]);
    expect(first.events.find(n=>n.kind==='message')?.href).toBe('/chats?conversation=c');
    expect(usageNotices).toHaveBeenNthCalledWith(1,auth.admin,auth.user,null,first.serverTime);
    expect(usageNotices).toHaveBeenNthCalledWith(2,auth.admin,auth.user,null,second.serverTime);
  });
  it('keeps the CRM bigint cursor independent and loads budget notices only on the first page',async()=>{
    enableAlerts();vi.mocked(usageNotices).mockResolvedValue([oldNotice]);
    tables.crm_notification_events=Array.from({length:200},(_,i)=>({id:i+1,kind:'message',source_id:'m',created_at:now()}));
    const first=await feed(auth,now(),null,null);
    expect(first.nextAfter).toBe('200');
    const second=await feed(auth,now(),first.nextAfter,first.serverTime);
    expect(second.serverTime).toBe(first.serverTime);
    expect(second.events.some(n=>n.id.startsWith('ai-usage-'))).toBe(false);
    expect(usageNotices).toHaveBeenCalledTimes(1);
  });
  it('respects disabled alert preferences even on boot',async()=>{
    tables.crm_notification_preferences[0].preferences={...DEFAULT_PREFERENCES,messages:true,alerts:false};
    vi.mocked(usageNotices).mockResolvedValue([oldNotice]);
    expect((await feed(auth,null,null,null)).events).toEqual([]);
    expect(usageNotices).not.toHaveBeenCalled();
  });
  it('marks an incomplete usage projection while continuing to deliver ordinary notices',async()=>{
    enableAlerts();vi.mocked(usageNotices).mockRejectedValue(new Error('temporarily unavailable'));
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {
      const result=await feed(auth,now(),null,null);
      expect(result.usageNoticesUnavailable).toBe(true);
      expect(result.events.some(n=>n.kind==='message')).toBe(true);
    } finally { log.mockRestore(); }
  });
});
