import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), admin: vi.fn(), scope: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status=200) => Response.json(body,{status}) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client, createStaticAdminClient: m.admin }));
vi.mock('@/lib/supabase/tabOrgScope', () => ({ withTabOrg: m.scope }));
vi.mock('@/lib/email/orgAddedEmail', () => ({ sendOrgAddedEmail: vi.fn() }));
import { GET as members } from './route';
import { GET as users } from '../../admin/users/route';
const org='org';
const profiles=[
 {id:'linked',email:'linked@test.invalid',role:'super_admin',organization_id:'other'},
 {id:'visitor',email:'visitor@test.invalid',role:'super_admin',organization_id:org},
 {id:'regular',email:'regular@test.invalid',role:'vendedor',organization_id:org},
];
function adminClient() {
 return {from: (table:string) => {
  let rows: Record<string,unknown>[] = table==='profiles' ? profiles : [{user_id:'linked',role:'admin',organization_id:org}];
  const q={select:()=>q,limit:()=>q,
   eq:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return q;},
   or:()=>{rows=rows.filter(r=>r.organization_id===org||r.role==='super_admin');return q;},
   in:(key:string,values:unknown[])=>{rows=rows.filter(r=>values.includes(r[key]));return q;},
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve)};
  return q;
 }};
}
beforeEach(()=>{
 const admin=adminClient();
 m.admin.mockReturnValue(admin);m.auth.mockResolvedValue({ok:true,user:{organizationId:org},admin});
 m.scope.mockResolvedValue({id:'actor',role:'super_admin',organization_id:org});
 const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'actor',role:'super_admin',organization_id:org},error:null})};
 m.client.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:()=>q});
});
it('allows explicitly linked super admins as owners even when active in another organization',async()=>{
 const res=await members();expect(res.status).toBe(200);
 const rows=(await res.json()).members;
 expect(rows.find((r:{id:string})=>r.id==='linked')).toMatchObject({member:true,role:'admin',isSuperAdmin:true});
 expect(rows.find((r:{id:string})=>r.id==='visitor')).toMatchObject({member:false});
 expect(rows.find((r:{id:string})=>r.id==='regular')).toMatchObject({member:true});
});
it('includes linked super admins in team/master choices and excludes visitors',async()=>{
 const res=await users();expect(res.status).toBe(200);
 const rows=(await res.json()).users;
 expect(rows.find((r:{id:string})=>r.id==='linked')).toMatchObject({role:'admin',is_super_admin:true});
 expect(rows.map((r:{id:string})=>r.id)).toEqual(expect.arrayContaining(['linked','regular']));
 expect(rows.some((r:{id:string})=>r.id==='visitor')).toBe(false);
});
