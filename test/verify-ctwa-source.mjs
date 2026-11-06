// Standalone offline check. Node 24; PGLITE_MODULE may point at a local install.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { metaCtwa, evolutionCtwa, recordCtwa } from '../supabase/functions/_shared/ctwa.ts';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const read = file => readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const [org, conn, conv, lead, other, foreign] = [1,2,3,4,5,6].map(id);
const query = (sql, args=[]) => db.query(sql,args);
const one = async (sql,args=[]) => (await query(sql,args)).rows[0];
const source = async key => (await one('select lead_source from deals where id=$1',[key])).lead_source;
const link = key => query('update wa_conversations set deal_id=$1 where id=$2',[key,conv]);
const client = { rpc: async (_fn, args) => {
  await query('select record_wa_ctwa($1,$2,$3,$4,$5,$6,$7)',[args.p_org,args.p_connection,args.p_conv,args.p_message,args.p_time,args.p_provider,args.p_ref]);
  return { error:null };
}};
const ref = metaCtwa({ referral:{source_type:'ad',source_id:'test-ad',ctwa_clid:'test-click'} });
const qr = evolutionCtwa({message:{extendedTextMessage:{contextInfo:{externalAdReply:{sourceType:'ad',sourceId:'test-ad'}}}}});
const save = async (messageId, provider='meta', context={}) => assert.equal(await recordCtwa(client,{
  organizationId:org, connectionId:conn, conversationId:conv, timestamp:'2026-11-06T13:00:00Z', messageId, ...context,
},provider,provider==='meta'?ref:qr),true);

try {
  await db.exec(`
    create schema crm_internal;
    create role anon; create role authenticated; create role service_role;
    create table wa_conversations(id uuid primary key,organization_id uuid,connection_id uuid,is_group boolean not null default false,deal_id uuid);
    create table deals(id uuid primary key,organization_id uuid,deleted_at timestamptz,custom_fields jsonb);
    create table organization_settings(organization_id uuid primary key);
    create table custom_field_definitions(organization_id uuid,options text[], key text, entity_type text);
    create table deal_events(organization_id uuid,deal_id uuid,kind text,field text,old_value jsonb,new_value jsonb,actor_kind text,actor_id uuid);
    create function crm_internal.current_actor() returns table(kind text,id uuid) language sql as $$select 'system'::text,null::uuid$$;
  `);
  await query("insert into deals values($1,$2,null,'{\"origem\":\"Indicação\"}')",[other,org]);
  // Apply the real CRM source sync, legacy read and audit triggers.
  await db.exec(read('20261008193128_native_lead_source.sql').split('ALTER TABLE public.deal_lifecycle_events')[0]);
  await db.exec(read('20261106153000_ctwa_lead_source.sql'));
  await query('insert into wa_conversations(id,organization_id,connection_id) values($1,$2,$3)',[conv,org,conn]);
  const count = async () => Number((await one('select count(*) as n from crm_internal.wa_ctwa_referrals')).n);
  await save('wrong-org','meta',{organizationId:foreign});
  await save('wrong-conn','meta',{connectionId:foreign});
  assert.equal(await count(),0);
  await save('m1'); await save('m1');
  assert.equal(await count(),1);
  assert.equal((await one('select attributed_deal_id from crm_internal.wa_ctwa_referrals')).attributed_deal_id,null);
  await query('insert into deals(id,organization_id) values($1,$2)',[lead,org]);
  await link(lead);
  assert.equal(await source(lead),'Meta Ads');
  const stored = await one('select reference,attributed_deal_id from crm_internal.wa_ctwa_referrals');
  assert.equal(stored.reference.click_id,'test-click'); assert.equal(stored.attributed_deal_id,lead);
  assert.equal(Number((await one("select count(*) n from deal_events where kind='lead_source'")).n),1);
  // Human correction after automatic attribution wins over replay and fresh clicks.
  await query("update deals set lead_source='Google Ads' where id=$1",[lead]);
  await save('m1'); await save('m2','evolution');
  assert.equal(await source(lead),'Google Ads');
  // Explicit clear with audited previous value also wins.
  await query('update deals set lead_source=null where id=$1',[lead]);
  await save('m3');
  assert.equal(await source(lead),null);
  await link(other); await save('m1'); await save('qr','evolution');
  assert.equal((await one('select crm_internal.read_deal_lead_source(d) s from deals d where id=$1',[other])).s,'Indicação');
  // A different lead gets no old clicks when replacing an existing link.
  const next = id(7);
  await query('insert into deals(id,organization_id) values($1,$2)',[next,org]);
  await link(next); await save('m1');
  assert.equal(await source(next),null);
  await save('new-qr','evolution');
  assert.equal(await source(next),'Meta Ads');
  const sig = 'public.record_wa_ctwa(uuid,uuid,uuid,text,timestamptz,text,jsonb)';
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') ok",[role,sig])).ok,role==='service_role');
  }
  console.log('OK: CTWA metadata, both link orders, manual and legacy sources, explicit clear, retries, relinking, scope and permissions.');
} finally { await db.close(); }
