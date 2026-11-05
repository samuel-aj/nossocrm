// Local PostgreSQL in memory only. Does not load .env or connect to Supabase.
// Install @electric-sql/pglite in a temporary prefix and pass its URL in PGLITE_MODULE.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [org, foreign, conv, agent, bot, connection, legacy] = [1, 2, 3, 4, 5, 6, 7].map(id);
const migration = readFileSync('supabase/migrations/20261105213530_scheduled_robot_return.sql', 'utf8');
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table wa_conversations(id uuid primary key, organization_id uuid, ai_agent_id uuid,
      ai_status text, ai_approval jsonb, ai_lock_until timestamptz, connection_id uuid, contact_id uuid, deal_id uuid,
      wa_phone text, ai_state jsonb);
    create table wa_ai_agents(id uuid primary key, organization_id uuid, enabled boolean, tools jsonb);
    create table wa_bots(id uuid primary key, organization_id uuid, enabled boolean, connection_id uuid, connection_ids uuid[]);
    create table wa_messages(organization_id uuid, conversation_id uuid, direction text, created_at timestamptz);
    create table wa_bot_runs(id uuid primary key default gen_random_uuid(), organization_id uuid,
      bot_id uuid, conversation_id uuid, contact_id uuid, deal_id uuid, phone text,
      status text, wake_at timestamptz, analytics_version integer, is_test boolean, vars jsonb,
      lock_until timestamptz, updated_at timestamptz default now(), error text);
    alter table wa_bot_runs enable row level security;
  `);
  await db.query('insert into wa_ai_agents values($1,$2,true,$3)', [agent, org, JSON.stringify({scheduled_return_bot_id: bot})]);
  await db.query('insert into wa_bots values($1,$2,true,$3,$4)', [bot, org, connection, [connection]]);
  await db.query("insert into wa_conversations(id,organization_id,ai_agent_id,ai_status,connection_id,wa_phone,ai_state) values($1,$2,$3,'active',$4,'5500000000000',$5)", [conv, org, agent, connection, JSON.stringify({preserved: 'memory'})]);
  await db.query("insert into wa_bot_runs(id,organization_id,conversation_id,status,vars) values($1,$2,$3,'done',$4)", [legacy, org, conv, JSON.stringify({preserved: 'history'})]);
  await db.query("insert into wa_messages values($1,$2,'in',now()-interval '1 hour')", [org, conv]);
  const before = (await db.query('select * from wa_bot_runs where id=$1', [legacy])).rows[0];
  await db.exec(migration);
  const row = async (run) => (await db.query('select * from wa_bot_runs where id=$1', [run])).rows[0];
  const baseline = await row(legacy);
  for (const key of Object.keys(before)) assert.deepEqual(baseline[key], before[key]);
  assert.equal(baseline.scheduled_for, null);
  assert.equal((await db.query("select relrowsecurity from pg_class where relname='wa_bot_runs'")).rows[0].relrowsecurity, true);
  const anchor = (await db.query('select max(created_at) as t from wa_messages')).rows[0].t;
  const at = (await db.query("select now()+interval '1 day' as t")).rows[0].t;
  const schedule = async (override={}) => {
    const p = {org, conv, agent, bot, at, timezone:'America/Manaus', anchor, context:'Retorno combinado sobre documentação', ...override};
    return (await db.query('select schedule_robot_return($1,$2,$3,$4,$5,$6,$7,$8) as id', [p.org,p.conv,p.agent,p.bot,p.at,p.timezone,p.anchor,p.context])).rows[0].id;
  };
  const begin = async (run, orgId=org) => (await db.query('select begin_scheduled_robot_return($1,$2) as ok', [orgId,run])).rows[0].ok;
  const cancel = async (override={}) => {
    const p = {org,conv,agent,anchor,...override};
    return (await db.query('select cancel_scheduled_robot_return($1,$2,$3,$4) as count', [p.org,p.conv,p.agent,p.anchor])).rows[0].count;
  };
  const clear = async () => db.query('delete from wa_bot_runs where id<>$1', [legacy]);
  const makeDue = async (run) => db.query("update wa_bot_runs set scheduled_for=now()-interval '1 second',wake_at=now()-interval '1 second' where id=$1",[run]);

  // Trusted organization/agent/number, explicit finite future and nonempty context.
  await assert.rejects(schedule({org:foreign}), /Conversa indisponível/);
  await assert.rejects(schedule({agent:id(99)}), /Conversa indisponível/);
  await assert.rejects(schedule({bot:id(99)}), /não autorizado/);
  for (const invalid of [null, '2000-01-01T00:00:00Z', 'infinity']) await assert.rejects(schedule({at:invalid}), /Data deve/);
  for (const invalid of [null, '', ' ', 'a'.repeat(1001)]) await assert.rejects(schedule({context:invalid}), /Contexto deve/);
  await assert.rejects(schedule({timezone:'Not/AZone'}), /Fuso inválido/);
  await assert.rejects(schedule({anchor:null}), /Cliente respondeu/);
  await db.exec('update wa_ai_agents set enabled=false');
  await assert.rejects(schedule(), /não autorizado/);
  await db.exec('update wa_ai_agents set enabled=true; update wa_bots set enabled=false');
  await assert.rejects(schedule(), /número da conversa/);
  await db.exec('update wa_bots set enabled=true');
  await db.query('update wa_bots set organization_id=$1',[foreign]);
  await assert.rejects(schedule(), /número da conversa/);
  await db.query('update wa_bots set organization_id=$1',[org]);
  await db.query('update wa_bots set connection_ids=$1', [[id(90)]]);
  await assert.rejects(schedule(), /número da conversa/);
  await db.exec("update wa_bots set connection_ids='{}'::uuid[]"); // Legacy number fallback.
  await db.exec('update wa_bots set connection_id=null');
  await assert.rejects(schedule(), /número da conversa/);
  await db.query('update wa_bots set connection_id=$1',[connection]);
  let run = await schedule();
  assert.equal((await row(run)).scheduled_connection_id, connection);
  assert.equal((await row(run)).is_test, false); // Real metadata, still only inside this in-memory DB.
  assert.equal((await row(run)).wake_at.getTime(), at.getTime());
  assert.equal(await schedule(), run); // Retry is one run, not another delivery.
  const replacement = await schedule({context:'Cliente alterou o assunto do retorno'});
  assert.notEqual(replacement, run);
  assert.equal((await row(run)).status, 'cancelled');
  assert.equal((await row(run)).wake_at, null);
  assert.equal((await row(replacement)).status, 'running');
  await assert.rejects(db.query("insert into wa_bot_runs(organization_id,conversation_id,status,scheduled_for) values($1,$2,'running',$3)",[org,conv,at]), /duplicate key/);
  await db.query("update wa_bot_runs set lock_until=now()+interval '1 minute' where id=$1",[replacement]);
  await assert.rejects(schedule(), /robô executando/);
  await clear();
  await db.query("insert into wa_bot_runs(organization_id,conversation_id,status) values($1,$2,'waiting_reply')",[org,conv]);
  await assert.rejects(schedule(), /robô executando/);
  await clear();

  // A worker cannot start early or cross organizations. Claim persists guard context
  // atomically with the start marker, preserving unrelated variables and AI memory.
  run = await schedule();
  assert.equal(await begin(run), false);
  await makeDue(run);
  assert.equal(await begin(run, foreign), false);
  const dueWake = (await row(run)).wake_at;
  await db.exec("update wa_conversations set ai_lock_until=now()+interval '1 minute'");
  assert.equal(await begin(run), false);
  assert.equal((await row(run)).status, 'running');
  assert.equal((await row(run)).scheduled_started_at, null);
  assert.equal((await row(run)).wake_at.getTime(), dueWake.getTime());
  await db.exec('update wa_conversations set ai_lock_until=null');
  assert.equal(await begin(run), true);
  const started = await row(run);
  assert.ok(started.scheduled_started_at);
  assert.equal(started.vars.contexto_extra, 'Retorno combinado sobre documentação');
  assert.equal(started.vars.__proactive_followup.scheduledReturnId, run);
  assert.equal(Date.parse(started.vars.__proactive_followup.anchor), anchor.getTime());
  // Once an inbound reply clears the proactivity marker, a replay must not recreate it.
  await db.query("update wa_bot_runs set vars=vars-'__proactive_followup' where id=$1",[run]);
  assert.equal(await begin(run), true);
  assert.equal((await row(run)).vars.__proactive_followup, undefined);
  assert.equal((await row(run)).scheduled_started_at.getTime(), started.scheduled_started_at.getTime());
  await clear();

  // Every execution-time change prevents the old agreement from acting.
  for (const change of ["ai_status='paused'", "ai_approval='{}'", `ai_agent_id='${id(50)}'`, `connection_id='${id(51)}'`, `deal_id='${id(52)}'`, `contact_id='${id(53)}'`]) {
    run = await schedule();
    await makeDue(run);
    await db.exec(`update wa_conversations set ${change}`);
    assert.equal(await begin(run), false);
    assert.equal((await row(run)).status, 'cancelled');
    await db.query("update wa_conversations set ai_status='active',ai_approval=null,ai_agent_id=$1,connection_id=$2,deal_id=null,contact_id=null",[agent,connection]);
    await clear();
  }

  // Cancellation is scoped to the captured turn and cannot cancel a newer agreement.
  run = await schedule();
  await assert.rejects(cancel({org:foreign}), /Conversa indisponível/);
  await assert.rejects(cancel({agent:id(60)}), /Conversa indisponível/);
  await assert.rejects(cancel({anchor:null}), /Cliente respondeu/);
  assert.equal((await row(run)).status, 'running');
  assert.equal(await cancel(), 1);
  assert.equal(await cancel(), 0);
  assert.equal(await begin(run), false);
  await clear();

  // Outbound, old and foreign messages do not affect the pending return.
  run = await schedule();
  await db.query("insert into wa_messages values($1,$2,'out',now())",[org,conv]);
  await db.query("insert into wa_messages values($1,$2,'in',$3)",[org,conv,anchor]);
  await db.query("insert into wa_messages values($1,$2,'in',now())",[foreign,conv]);
  assert.equal((await row(run)).status, 'running');
  await db.query("insert into wa_messages values($1,$2,'in',now())",[org,conv]);
  assert.equal((await row(run)).status, 'cancelled');
  assert.equal((await row(run)).wake_at, null);
  const newAnchor=(await db.query("select max(created_at) as t from wa_messages where organization_id=$1 and conversation_id=$2 and direction='in'",[org,conv])).rows[0].t;
  const newer=await schedule({anchor:newAnchor});
  await assert.rejects(cancel(), /Cliente respondeu/);
  assert.equal((await row(newer)).status,'running');

  for (const signature of [
    'schedule_robot_return(uuid,uuid,uuid,uuid,timestamptz,text,timestamptz,text)',
    'cancel_scheduled_robot_return(uuid,uuid,uuid,timestamptz)',
    'begin_scheduled_robot_return(uuid,uuid)',
  ]) {
    for (const role of ['anon','authenticated']) assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as ok',[role,signature])).rows[0].ok,false);
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') as ok",[signature])).rows[0].ok,true);
  }
  assert.equal((await db.query("select has_function_privilege('authenticated','cancel_unstarted_robot_return_on_reply()','execute') as ok")).rows[0].ok,false);
  assert.deepEqual((await db.query('select ai_state from wa_conversations')).rows[0].ai_state,{preserved:'memory'});
  assert.deepEqual((await row(legacy)).vars,{preserved:'history'});
  console.log('SQL OK: additive migration, preserved history, organization isolation, authorization, idempotency, replacement, exclusive pending run, due-time/start/replay guards, manual pause, reply cancellation, cancellation race guard, service-only grants and existing RLS. No network or real messages.');
} finally { await db.close(); }
