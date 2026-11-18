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
  vi.stubEnv('WA_CONNECTION_HOSTINGER_MAIL_TOKEN','');
  rpc.mockResolvedValue({data:[row]});
  const result=await connectionIncidentNotices(auth,null,before);
  expect(rpc).toHaveBeenCalledWith('wa_connection_bell',{p_org:'org',p_user:'user',p_until:before});
  expect(result[0]).toMatchObject({category:'connection_outage',title:'Falha na conexão do WhatsApp',tone:'red'});
  expect(result[0].message).toContain('e-mail aguarda');
  const rules={...DEFAULT_VISIBILITY_RULES,whatsapp:{...DEFAULT_VISIBILITY_RULES.whatsapp,connection_ids:[]}};
  expect(await connectionIncidentNotices(auth,rules,before)).toEqual([]);
});
it('shows the operator how to check an unconfirmed send and distinguishes rejection',async()=>{
  rpc.mockResolvedValue({data:[{...row,mail_state:'unconfirmed'},{...row,mail_state:'failed'}]});
  const [unknown,failed]=await connectionIncidentNotices(auth,null,before);
  expect(unknown.message).toContain('sem confirmação');
  expect(failed.message).toContain('recusou');
});
it('recognizes a configured Hostinger sender in the bell',async()=>{
  vi.stubEnv('RESEND_API_KEY','');
  vi.stubEnv('WA_CONNECTION_HOSTINGER_MAIL_TOKEN','test-mailbox-token');
  vi.stubEnv('WA_CONNECTION_HOSTINGER_MAILBOX_ID','ACexample');
  vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_FROM','CRM <crm@example.invalid>');
  vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_START_AT',before);
  rpc.mockResolvedValue({data:[row]});
  expect((await connectionIncidentNotices(auth,null,before))[0].message).not.toContain('aguarda a configuração');
});
it('shows recovery as a distinct notice and keeps the number quarantine understandable',async()=>{
  rpc.mockResolvedValue({data:[{...row,reason:'number_changed'},{...row,id:'resolved',phase:'resolved'}]});
  const [opened,resolved]=await connectionIncidentNotices(auth,null,before);
  expect(opened.message).toContain('pareado mudou');
  expect(resolved).toMatchObject({id:'wa-line-resolved',tone:'green',title:'WhatsApp reconectado'});
});
