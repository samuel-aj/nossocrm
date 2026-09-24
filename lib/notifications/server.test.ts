import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/permissions/teamAccessServer',async()=>{
  const actual=await vi.importActual<typeof import('@/lib/permissions/teamAccessServer')>('@/lib/permissions/teamAccessServer');
  return {...actual,getTeamAccess:vi.fn()};
});
vi.mock('@/lib/permissions/server',()=>({getVisibilityRules:vi.fn(),connectionAllowed:(rules:{whatsapp:{connection_ids:string[]|null}}|null,id:string)=>!rules?.whatsapp.connection_ids || rules.whatsapp.connection_ids.includes(id)}));
import {getTeamAccess} from '@/lib/permissions/teamAccessServer';
import {getVisibilityRules} from '@/lib/permissions/server';
import {DEFAULT_VISIBILITY_RULES} from '@/lib/permissions/types';
import {context,feed,saveSettings} from './server';
import {DEFAULT_PREFERENCES,PreferencesSchema} from './types';

const org='org-a',user='user-a';
let tables:Record<string,Record<string,unknown>[]>;
const queries:Array<{table:string;filters:Array<[string,unknown]>}>=[];
function from(table:string) {
  const filters:Array<[string,unknown]>=[];queries.push({table,filters});
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q;},is:()=>q,in:()=>q,gte:()=>q,lte:()=>q,gt:()=>q,order:()=>q,limit:()=>q,
    maybeSingle:()=>Promise.resolve({data:tables[table]?.[0] ?? null,error:null}),
    upsert:vi.fn().mockResolvedValue({error:null}),
    then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:tables[table] ?? [],error:null}).then(resolve)};
  return q;
}
const auth={ok:true as const,user:{id:user,organizationId:org,role:'vendedor'},admin:{from}} as unknown as Parameters<typeof feed>[0];
const now=()=>new Date().toISOString();
async function notices(){return (await feed(auth,now(),null,null)).events;}
beforeEach(()=>{
  queries.length=0;
  vi.mocked(getTeamAccess).mockResolvedValue({fullAccess:true,canManage:false,legacy:true,masterUserId:null,boards:[]});
  vi.mocked(getVisibilityRules).mockResolvedValue(null);
  tables={boards:[{id:'b',name:'Vendas'}],crm_notification_preferences:[{preferences:{...DEFAULT_PREFERENCES,messages:true,scope:'all',leads:true,boardIds:['11111111-1111-4111-8111-111111111111']}}],crm_notification_events:[{id:1,kind:'message',source_id:'m',created_at:now()}],wa_messages:[{id:'m',conversation_id:'c'}],wa_conversations:[{id:'c',contact_id:'contact',connection_id:'connection',wa_name:'Cliente',label_ids:[]}],deals:[{id:'d',title:'Lead',board_id:'b',owner_id:user,contact_id:'contact',is_won:false,is_lost:false}]};
});
describe('personal notification security and audiences',()=>{
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
