import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const org = '00000000-0000-4000-8000-000000000001';
const line = '00000000-0000-4000-8000-000000000002';
const user = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
const conv = '00000000-0000-4000-8000-000000000005';
const otherOrg = '00000000-0000-4000-8000-000000000006';
const visitor = '00000000-0000-4000-8000-000000000007';
const q = (s,p=[])=>db.query(s,p).then(r=>r.rows);
try {
  await db.exec(`
    create role service_role bypassrls; create role authenticated; create role anon;
    create schema auth; create schema crm_internal; create schema cron;
    create schema net;
    create table net._http_response(id bigint primary key,status_code integer,timed_out boolean);
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create table organizations(id uuid primary key);
    create table auth.users(id uuid primary key,email text,banned_until timestamptz);
    create table profiles(id uuid primary key references auth.users,organization_id uuid,role text);
    create table user_organizations(user_id uuid,organization_id uuid,role text);
    create table user_visibility_rules(user_id uuid,organization_id uuid,rules jsonb);
    create table wa_connections(id uuid primary key,organization_id uuid,phone_number text,profile_name text,
       provider text,instance_name text,instance_token text,base_url text,meta_phone_number_id text,status text,last_connected_at timestamptz);
    create table wa_conversations(id uuid primary key,organization_id uuid,connection_id uuid);
    create table wa_messages(organization_id uuid,conversation_id uuid,direction text,status text,evolution_message_id text,source text,wa_timestamp timestamptz,created_at timestamptz);
    create function br_phone_variants(text) returns text[] language sql as $$select array[$1]$$;
    create function wa_agents_call_app(text,jsonb) returns bigint language sql as $$select 1::bigint$$;
    revoke all on function wa_agents_call_app(text,jsonb) from public,service_role;
    grant all on all tables in schema public to service_role;
    insert into organizations values ('${org}'),('${otherOrg}');
    insert into auth.users values ('${user}','admin@example.invalid',null),('${outsider}','other@example.invalid',null),('${visitor}','master@example.invalid',null);
    insert into profiles values ('${user}','${org}','admin'),('${outsider}','${otherOrg}','admin'),('${visitor}','${org}','super_admin');
    insert into wa_connections(id,organization_id,phone_number,status,last_connected_at) values ('${line}','${org}','+5511000000001','connected','2026-01-01 06:00Z');
    insert into wa_conversations values ('${conv}','${org}','${line}');
  `);
  for(const m of ['20261118140000_wa_connection_incidents','20261118160000_wa_connection_monitor','20261118190000_wa_connection_hostinger_mail']) {
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`,'utf8'));
  }
  assert.equal((await q("select has_function_privilege('authenticated','wa_claim_connection_probes(integer)','execute') ok"))[0].ok,false);
  assert.equal((await q("select has_function_privilege('anon','wa_claim_connection_emails(integer)','execute') ok"))[0].ok,false);
  assert.equal((await q("select has_function_privilege('authenticated','wa_claim_connection_email_batch(int,text[],timestamptz)','execute') ok"))[0].ok,false);
  assert.equal((await q("select has_function_privilege('anon','wa_begin_hostinger_connection_email(uuid,uuid)','execute') ok"))[0].ok,false);
  assert.equal((await q("select relrowsecurity from pg_class where relname='wa_connection_incidents'"))[0].relrowsecurity,true);
  assert.equal((await q("select has_function_privilege('authenticated','crm_internal.dispatch_wa_connection_monitor()','execute') ok"))[0].ok,false);
  await db.exec(`
    insert into crm_internal.wa_connection_monitor_dispatches(request_id,result,requested_at) values
      (2,'pending',now()),(3,'pending',now()),(4,'pending',now()),(5,'pending',now()),
      (6,'pending',now()-interval '4 minutes'),(7,'accepted',now()-interval '31 days');
    insert into net._http_response values (2,202,false),(3,503,false),(4,null,true),(5,null,false);
    select crm_internal.dispatch_wa_connection_monitor();
  `);
  assert.deepEqual((await q('select result,http_status from crm_internal.wa_connection_monitor_dispatches order by request_id')).map(x=>[x.result,x.http_status]),
    [['pending',null],['accepted',202],['http_error',503],['timeout',null],['transport_error',null],['no_response',null]]);
  await db.exec('set role service_role');
  assert.equal((await q('select id from wa_claim_connection_probes(2)')).length,1);
  assert.equal((await q('select id from wa_claim_connection_probes(2)')).length,0);
  const observe = async (state,source,time,reason=null,phone=null) => (await q(
    'select wa_observe_connection($1,$2,$3,$4,$5,$6,null) ok',[line,state,source,`2026-01-02T${time}Z`,reason,phone]))[0].ok;
  await assert.rejects(()=>q('update wa_connections set health_alert_owner_id=$1 where id=$2',[outsider,line]));
  await q('update wa_connections set health_alert_owner_id=$1 where id=$2',[user,line]);
  assert.equal(await observe('connecting','webhook','07:55:00'),false);
  assert.equal((await q('select status from wa_connections'))[0].status,'connected');
  assert.equal((await q('select * from wa_connection_incidents')).length,0);
  await observe('connected','poll','07:55:01');
  await observe('disconnected','webhook','08:00:00');
  await observe('disconnected','send_blocked','08:01:00','local_gate');
  await observe('disconnected','poll','08:01:01','evolution_state_close');
  await observe('disconnected','poll','08:01:02','evolution_disconnect_401');
  await observe('disconnected','poll','08:01:03','evolution_disconnect_401');
  assert.equal((await q("select reason from wa_connection_health_events where source='send_blocked' and reason='local_gate'")).length,1);
  assert.equal((await q("select reason from wa_connection_health_events where reason='evolution_disconnect_401'")).length,1);
  assert.equal((await q('select * from wa_connection_incidents')).length,1);
  assert.equal((await q('select user_id from wa_connection_incident_notices')).length,1);
  assert.equal((await q('select * from wa_connection_bell($1,$2,now())',[org,user])).length,1);
  assert.equal((await q('select * from wa_connection_bell($1,$2,now())',[org,visitor])).length,0);
  assert.equal(await observe('connected','webhook','07:59:59'),false);
  assert.equal(await observe('connected','webhook','08:02:00'),false);

  // Simulate a provider cutover with an old backlog, lost responses and worker restarts.
  await db.exec('begin');
  await q(`WITH old AS (
    INSERT INTO wa_connection_incidents(organization_id,connection_id,line_label,opened_at,resolved_at,reason,source)
    SELECT $1,$2,'Linha antiga',now()-interval '2 hours',now()-interval '1 hour','disconnected','poll'
    FROM generate_series(1,29) RETURNING id
  ) INSERT INTO wa_connection_incident_notices(incident_id,organization_id,user_id,phase,recipient_email,created_at,next_attempt_at)
    SELECT id,$1,$3,'resolved','admin@example.invalid',now()-interval '1 hour',now()-interval '1 hour' FROM old`, [org,line,user]);
  const claimHost = () => q("select * from wa_claim_connection_email_batch(1,array['hostinger','resend'],now()-interval '30 minutes')");
  const beginHost = async job => (await q('select wa_begin_hostinger_connection_email($1,$2) ok',[job.id,job.lease_token]))[0].ok;
  const finishHost = async (job,error) => (await q('select wa_finish_connection_email($1,$2,$3) ok',[job.id,job.lease_token,error]))[0].ok;
  const mailState = async id => (await q('select mail_state from wa_connection_incident_notices where id=$1',[id]))[0].mail_state;
  const [first] = await claimHost();
  assert.equal(first.phase,'opened');
  assert.equal(first.mail_provider,'hostinger');
  assert.equal((await q("select id from wa_connection_incident_notices where last_error='before_mail_activation' and attempts=0")).length,29);
  assert.equal((await q('select * from wa_connection_bell($1,$2,now())',[org,user])).length,30);
  // Crash before submission: reclaim only with the original provider and a fresh lease.
  await q("update wa_connection_incident_notices set lease_until=now()-interval '1 second' where id=$1",[first.id]);
  assert.equal((await q('select * from wa_claim_connection_emails(12)')).length,0);
  const [retry] = await claimHost();
  assert.equal(await beginHost(first),false);
  assert.equal(await beginHost(retry),true);
  assert.equal(await beginHost(retry),false);
  assert.equal(await finishHost(retry,'hostinger_http_429'),true);
  assert.equal(await mailState(retry.id),'pending');
  assert.equal((await claimHost()).length,0);
  await q('update wa_connection_incident_notices set next_attempt_at=now() where id=$1',[retry.id]);
  const [again] = await claimHost();
  // Recheck visibility immediately before the remote request.
  await db.exec('savepoint revoke_recipient');
  await q("insert into user_visibility_rules values ($1,$2,'{\"whatsapp\":{\"connection_ids\":[]}}')",[user,org]);
  assert.equal(await beginHost(again),false);
  assert.equal(await mailState(again.id),'cancelled');
  await db.exec('rollback to revoke_recipient');
  assert.equal(await beginHost(again),true);
  // A crash during submission or after 204 but before the local acknowledgement cannot be retried.
  await q("update wa_connection_incident_notices set lease_until=now()-interval '1 second' where id=$1",[again.id]);
  assert.equal((await claimHost()).length,0);
  assert.equal(await mailState(again.id),'unconfirmed');
  assert.equal((await q('select * from wa_claim_connection_emails(12)')).length,0);
  assert.equal((await q('select * from wa_connection_bell($1,$2,now()) where id=$3',[org,user,again.id]))[0].mail_state,'unconfirmed');
  await db.exec('rollback');

  const [job]=await q('select * from wa_claim_connection_emails(12)');
  assert.equal(job.recipient_email,'admin@example.invalid');
  assert.equal((await q('select * from wa_claim_connection_emails(12)')).length,0);
  assert.equal((await q('select wa_finish_connection_email($1,$2,null) ok',[job.id,outsider]))[0].ok,false);
  assert.equal((await q('select wa_finish_connection_email($1,$2,null) ok',[job.id,job.lease_token]))[0].ok,true);
  await q("insert into wa_messages values ($1,$2,'out','delivered','a','crm','2026-01-01 21:00Z','2026-01-01 21:00Z')",[org,conv]);
  assert.equal((await q('select resolved_at from wa_connection_incidents'))[0].resolved_at,null);
  await q("insert into wa_messages values ($1,$2,'out','delivered','b','crm','2026-01-02 08:04Z','2026-01-02 08:04Z')",[org,conv]);
  assert.equal((await q('select * from wa_connection_incidents where resolved_at is null')).length,0);
  assert.equal(await observe('disconnected','send_blocked','08:05:00','local_gate'),false);
  await observe('unknown','poll','08:06:00','probe_timeout');
  await observe('unknown','poll','08:13:00','probe_timeout');
  await observe('unknown','poll','08:13:30','probe_timeout');
  assert.equal((await q("select reason from wa_connection_health_events where reason='probe_timeout'")).length,2);
  assert.equal((await q('select reason from wa_connection_incidents where resolved_at is null'))[0].reason,'verification_unavailable');
  await observe('connected','poll','08:14:00');
  await observe('connected','webhook','08:15:00','connected','+5511000000002');
  assert.equal((await q('select phone_number,status from wa_connections'))[0].status,'disconnected');
  assert.equal((await q('select id from wa_conversations')).length,1);
  assert.equal(await observe('connected','poll','08:16:00'),false);
  assert.equal((await q('select phone_number from wa_connections'))[0].phone_number,'+5511000000001');
  await observe('connected','webhook','08:17:00','connected','+5511000000001');
  await observe('connected','poll','08:18:00');
  assert.equal((await q('select * from wa_connection_incidents where resolved_at is null')).length,0);
  await observe('disconnected','manual','08:20:00');
  assert.equal(await observe('connected','poll','08:21:00'),false);
  assert.equal((await q('select health_monitor_enabled from wa_connections'))[0].health_monitor_enabled,false);
  console.log('Validated connection incidents, monitored line reservations, organization recipients, bell/email deduplication, stale observations, delivery proof, identity quarantine and manual disconnect in isolated PostgreSQL.');
} finally { await db.close(); }
