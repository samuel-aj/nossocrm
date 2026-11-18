import { afterEach, expect, it, vi } from 'vitest';
import { connectionIncidentNotices } from './connectionIncidents';
import { DEFAULT_VISIBILITY_RULES } from '@/lib/permissions/types';
const rpc=vi.fn();
const auth={user:{id:'user',organizationId:'org'},admin:{rpc}} as unknown as Parameters<typeof connectionIncidentNotices>[0];
const before='2026-11-18T15:00:00Z';
const row={id:'event',created_at:before,connection_id:'conn',line_label:'Linha A',reason:'local_gate',phase:'opened',mail_state:'pending'};
afterEach(()=>vi.unstubAllEnvs());
it('scopes the operational bell to the user and org and shows unconfigured email',async()=>{
  vi.stubEnv('RESEND_API_KEY','');
  rpc.mockResolvedValue({data:[row]});
  const result=await connectionIncidentNotices(auth,null,before);
  expect(rpc).toHaveBeenCalledWith('wa_connection_bell',{p_org:'org',p_user:'user',p_until:before});
  expect(result[0]).toMatchObject({category:'connection_outage',title:'Falha na conexão do WhatsApp',tone:'red'});
  expect(result[0].message).toContain('e-mail aguarda');
  const rules={...DEFAULT_VISIBILITY_RULES,whatsapp:{...DEFAULT_VISIBILITY_RULES.whatsapp,connection_ids:[]}};
  expect(await connectionIncidentNotices(auth,rules,before)).toEqual([]);
});
it('shows recovery as a distinct notice and keeps the number quarantine understandable',async()=>{
  rpc.mockResolvedValue({data:[{...row,reason:'number_changed'},{...row,id:'resolved',phase:'resolved'}]});
  const [opened,resolved]=await connectionIncidentNotices(auth,null,before);
  expect(opened.message).toContain('pareado mudou');
  expect(resolved).toMatchObject({id:'wa-line-resolved',tone:'green',title:'WhatsApp reconectado'});
});
