import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const db = new PGlite();
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const [org, elsewhere, line, otherLine, hiddenLine, conv, otherConv, hiddenConv] = Array.from({ length: 8 }, (_, n) => uuid(n + 1));
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table wa_connections(id uuid primary key, organization_id uuid, last_connected_at timestamptz);
    create table wa_connection_incidents(connection_id uuid, opened_at timestamptz, reason text, resolved_at timestamptz, organization_id uuid, source text);
    create table wa_connection_health_events(id bigint generated always as identity, connection_id uuid, organization_id uuid, observed_at timestamptz, state text, source text, reason text, applied boolean);
    create table wa_conversations(id uuid primary key, organization_id uuid, connection_id uuid);
    create table wa_messages(organization_id uuid, conversation_id uuid, direction text, status text, created_at timestamptz);
    create table wa_agent_connection_pending(organization_id uuid, connection_id uuid, state text);
    grant select on all tables in schema public to service_role;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261118180000_wa_line_diagnostics.sql', import.meta.url), 'utf8'));
  await db.query("insert into wa_connections values ($1,$2,now()-interval '4 hours'),($3,$2,now()),($4,$5,now())", [line, org, otherLine, hiddenLine, elsewhere]);
  await db.query('insert into wa_conversations values ($1,$2,$3),($4,$2,$5),($6,$7,$8)', [conv, org, line, otherConv, otherLine, hiddenConv, elsewhere, hiddenLine]);
  await db.query(`insert into wa_connection_incidents values
    ($1,now()-interval '2 hours','crm_send_blocked',null,$3,'send_blocked'),
    ($2,now()-interval '4 hours','crm_send_blocked',now()-interval '3 hours',$3,'send_blocked'),
    ($2,now()-interval '1 day','old',now()-interval '23 hours',$3,'poll')`, [line,otherLine,org]);
  await db.query(`insert into wa_connection_health_events(connection_id,organization_id,observed_at,state,source,reason,applied) values
    ($1,$3,now()-interval '80 minutes','disconnected','webhook','evolution_disconnect_401',true),
    ($1,$3,now()-interval '70 minutes','disconnected','poll','evolution_state_close',true),
    ($1,$3,now()-interval '50 minutes','disconnected','webhook','evolution_disconnect_403',false),
    ($2,$3,now()-interval '195 minutes','disconnected','send_failure','meta_code_190',true),
    ($2,$3,now()-interval '30 minutes','disconnected','webhook','evolution_disconnect_502',true),
    ($2,$4,now()-interval '190 minutes','disconnected','send_failure','meta_code_185',true)`, [line,otherLine,org,elsewhere]);
  await db.query(`insert into wa_messages values
    ($1,$2,'out','read',now()-interval '3 hours'),($1,$2,'in','received',now()-interval '90 minutes'),
    ($1,$2,'out','failed',now()-interval '80 minutes'),($1,$2,'out','failed',now()-interval '70 minutes'),
    ($1,$3,'out','failed',now()-interval '1 hour'),($1,$3,'out','failed',now()-interval '30 min'),
    ($4,$5,'out','delivered',now())`, [org, conv, otherConv, elsewhere, hiddenConv]);
  await db.query(`insert into wa_agent_connection_pending values
    ($1,$2,'pending'),($1,$2,'dispatching'),($1,$2,'review'),($1,$2,'cancelled'),($3,$4,'pending')`, [org, line, elsewhere, hiddenLine]);
  await db.exec('set role service_role');
  const list = (orgId, ids) => db.query('select * from wa_line_diagnostics($1,$2::uuid[])', [orgId, ids]);
  const { rows } = await list(org, [line, otherLine, hiddenLine]);
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.connection_id === line);
  assert.equal(a.incident_reason, 'crm_send_blocked');
  assert.deepEqual([a.diagnostic_source, a.diagnostic_reason, a.last_incident_resolved_at], ['webhook','evolution_disconnect_401',null]);
  assert.ok(a.last_delivered_message_at < a.opened_at && a.last_inbound_at >= a.opened_at);
  assert.deepEqual([a.failed_count, a.pending_count, a.review_count], [2, 2, 1]);
  const b = rows.find(r => r.connection_id === otherLine);
  assert.deepEqual([b.failed_count, b.pending_count, b.review_count, b.last_delivered_message_at], [0, 0, 0, null]);
  assert.deepEqual([b.opened_at, b.last_incident_source, b.diagnostic_source, b.diagnostic_reason], [null, 'send_blocked', 'send_failure', 'meta_code_190']);
  assert.ok(b.last_incident_opened_at < b.diagnostic_at && b.diagnostic_at < b.last_incident_resolved_at);
  assert.equal((await list(org, [hiddenLine])).rows.length, 0);
  const third = (await list(elsewhere, [hiddenLine])).rows[0];
  assert.equal(third.pending_count, 1);
  assert.ok(third.last_delivered_message_at);
  const acl = await db.query("select has_function_privilege('authenticated','wa_line_diagnostics(uuid,uuid[])','EXECUTE') as allowed");
  assert.equal(acl.rows[0].allowed, false);
  await db.exec(`
    reset role;
    alter table wa_connection_incidents add column id uuid primary key default gen_random_uuid(), add column resolution text;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261118180001_wa_connection_history.sql', import.meta.url), 'utf8'));
  await db.query(`insert into wa_connection_incidents(connection_id, organization_id, opened_at, resolved_at, reason, source, resolution)
    select $1::uuid, $2::uuid, '2020-01-01T01:01:01.000001Z', '2020-01-01T01:01:02Z', 'crm_send_blocked', 'send_blocked', 'disabled'
    from generate_series(1,12)`, [line,org]);
  await db.exec('set role service_role');
  const history = (tenant, number, before = null, id = null, limit = 11) =>
    db.query('select *, opened_at::text as exact_time from wa_connection_history($1,$2,$3,$4,$5)', [tenant, number, before, id, limit]);
  const first = (await history(org,line)).rows;
  assert.equal(first.length,11);
  assert.deepEqual([first[0].diagnostic_source,first[0].diagnostic_reason], [a.diagnostic_source,a.diagnostic_reason]);
  const last = first[9];
  const second = (await history(org,line,last.exact_time,last.id)).rows;
  assert.equal(second.length,3);
  assert.equal(second[0].id,first[10].id);
  assert.equal(new Set([...first.slice(0,10),...second].map(row=>row.id)).size,13);
  assert.equal(second[0].resolution,'disabled');
  assert.equal((await history(elsewhere,line)).rows.length,0);
  assert.equal((await history(org,hiddenLine)).rows.length,0);
  assert.equal((await history(org,line,last.exact_time,null)).rows.length,0);
  assert.equal((await history(org,line,null,null,1000)).rows.length,11);
  const latestClosed = (await history(org,otherLine)).rows[0];
  assert.equal(latestClosed.diagnostic_reason,b.diagnostic_reason);
  const currentCard = (await list(org,[otherLine])).rows[0];
  assert.equal(currentCard.diagnostic_reason,latestClosed.diagnostic_reason);
  assert.equal(currentCard.diagnostic_at.getTime(),latestClosed.diagnostic_at.getTime());
  for (const role of ['anon','authenticated']) {
    const allowed = await db.query("select has_function_privilege($1,'wa_connection_history(uuid,uuid,timestamptz,uuid,integer)','execute') as allowed", [role]);
    assert.equal(allowed.rows[0].allowed,false);
  }
  console.log('PGlite: diagnostics migration, mixed receipts/failures, reconnection boundary, pending/review, tenant isolation and ACL passed.');
} finally {
  await db.close();
}
