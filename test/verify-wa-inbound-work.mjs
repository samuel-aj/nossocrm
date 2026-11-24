// Isolated PostgreSQL/WASM. Supply an installed PGlite module via PGLITE_MODULE.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const file = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const rows = async (sql, args = []) => (await db.query(sql,args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql,args))[0])[0];
const org = id(1), other = id(2), line = id(3), agent = id(4);
let conversationNumber = 20, messageNumber = 140;
async function conversation(tenant = org, status = 'active', assigned = agent, group = false) {
  const conv = id(conversationNumber++);
  await db.query('insert into wa_conversations(id,organization_id,connection_id,ai_agent_id,ai_status,is_group) values($1,$2,$3,$4,$5,$6)',
    [conv,tenant,line,assigned,status,group]);
  return conv;
}
async function message(conv, tenant = org, direction = 'in', source = 'inbound', status = 'received') {
  const mid = id(messageNumber++);
  await db.query('insert into wa_messages(id,organization_id,conversation_id,direction,source,status) values($1,$2,$3,$4,$5,$6)',
    [mid,tenant,conv,direction,source,status]);
  return mid;
}
const immediate = (mid,conv,tenant = org) => rows('select * from claim_wa_inbound_work($1,1,$2,$3)',[mid,tenant,conv]);
const batch = (conv, limit = 1) => rows('select * from claim_wa_inbound_work(null,$1,null,$2)',[limit,conv]);
const phase = (job,step,finished=false) => scalar('select advance_wa_inbound_work($1,$2,$3,$4)',[job.message_id,job.lease_token,step,finished]);
const finish = (job,outcome,reason=outcome) => scalar('select finish_wa_inbound_work($1,$2,$3,$4)',[job.message_id,job.lease_token,outcome,reason]);
const state = mid => rows('select state,reason,attempts,last_failure from wa_inbound_work where message_id=$1',[mid]);
const events = mid => rows("select * from crm_notification_events where kind='wa_entry_recovery' and source_id=$1",[mid]);
const dueNow = mid => db.query("update wa_inbound_work set available_at=now()-interval '1 minute' where message_id=$1",[mid]);
async function claimed() {
  const conv = await conversation(), mid = await message(conv);
  return {conv, mid, job:(await immediate(mid,conv))[0]};
}
try {
  await db.exec(await file('supabase/tests/wa_inbound_work.fixture.sql'));
  const team = await file('supabase/migrations/20260924183723_linked_super_admin_assignment.sql');
  await db.exec(team.slice(0,team.indexOf('create or replace function public.vis_guard_deals')));
  await db.query('insert into organizations(id,beta) values ($1,true),($2,false)',[org,other]);
  const historic = await message(await conversation());
  await db.exec(await file('supabase/migrations/20261124151357_wa_inbound_work.sql'));
  await db.exec(await file('supabase/migrations/20261124151410_wa_entry_recovery_notifications.sql'));
  await db.exec(await file('supabase/migrations/20261124184908_wa_inbound_recovery_bot_guard.sql'));
  await db.exec(await file('supabase/tests/wa_entry_recovery_notifications.sql'));
  assert.deepEqual(await state(historic),[]);
  const cron = await scalar("select code from cron.jobs where name='wa-inbound-recovery'");
  await db.exec(cron);
  assert.deepEqual(await rows('select * from net.requests'),[]);

  const noRoute = await conversation(org,null,null);
  assert.deepEqual(await state(await message(noRoute)),[]);
  const group = await conversation(org,'active',agent,true);
  await db.query("insert into wa_bot_runs values($1,$2,'waiting_reply')",[org,group]);
  assert.deepEqual(await state(await message(group)),[]);
  const cross = await conversation(other);
  assert.deepEqual(await state(await message(cross,org)),[]);
  assert.deepEqual(await state(await message(await conversation(),org,'out','crm','sent')),[]);
  const imported = id(messageNumber++);
  await db.query("insert into wa_messages(id,organization_id,conversation_id,direction,wa_timestamp) values($1,$2,$3,'in',now()-interval '2 days')",[imported,org,await conversation()]);
  assert.deepEqual(await state(imported),[]);
  // A missing base URL/secret drops the immediate POST, not the transaction.
  const delayed = await conversation(), missed = await message(delayed);
  assert.equal((await state(missed))[0].state,'pending');
  assert.deepEqual(await rows('select * from net.requests'),[]);
  await db.exec("insert into platform_config values('wa_agents_app_url','http://fixture.invalid'),('wa_agents_internal_secret','fixture')");
  await db.exec(cron);
  assert.deepEqual(await scalar('select body from net.requests'),{job:'inbound_recovery'});
  const [late] = await batch(delayed);
  assert.equal(late.message_id,missed);
  assert.equal(late.direct_wakeup,false);
  assert.equal(await phase(late,'bots'),'ready');
  assert.equal(await phase(late,'bots',true),'ready');
  assert.equal(await finish(late,'done'),'done');

  const conv = await conversation(), mid = await message(conv);
  const [request] = await rows('select url,body from net.requests order by id desc limit 1');
  assert.deepEqual(request,{url:'http://fixture.invalid/api/wa-agents/inbound-recovery',
    body:{organization_id:org,conversation_id:conv,message_id:mid}});
  assert.deepEqual(await immediate(mid,conv,other),[]);
  assert.deepEqual(await immediate(mid,noRoute),[]);
  const [first] = await immediate(mid,conv);
  assert.equal(first.direct_wakeup,true);
  assert.deepEqual(await immediate(mid,conv),[]);
  assert.equal(await phase(first,'bots'),'ready');
  assert.equal(await phase(first,'bots'),'stale');
  assert.equal(await phase(first,'bots',true),'ready');
  assert.equal(await finish(first,'retry','lock_busy'),'pending');
  assert.deepEqual(await immediate(mid,conv),[]);
  assert.deepEqual(await batch(conv),[]);
  await dueNow(mid);
  const [second] = await batch(conv);
  assert.deepEqual(second.completed_steps,['bots']);
  assert.notEqual(first.lease_token,second.lease_token);
  assert.equal(await finish(first,'done'),'stale');
  assert.equal(await phase(second,'bots'),'stale');
  assert.equal(await phase(second,'dispatch'),'ready');
  assert.equal(await finish(second,'retry'),'review');
  assert.equal(await finish(second,'review'),'stale');
  assert.equal((await events(mid)).length,1);

  // Waiting bots do not require the AI beta or an active native agent.
  const bot = await conversation(other,'paused',null);
  await db.query("insert into wa_bot_runs values($1,$2,'waiting_reply')",[other,bot]);
  const botMid = await message(bot,other), [botJob] = await immediate(botMid,bot,other);
  assert.equal(await phase(botJob,'bots'),'ready');
  assert.equal(await finish(botJob,'done'),'done');
  // A notification lost or delayed must not replay this same bot over manual work.
  for (const change of ['human','cursor','resume','bot_reply','paused']) {
    const changed = await conversation(other,change==='paused'?'paused':'active',null);
    await db.query("insert into wa_bot_runs values($1,$2,'waiting_reply')",[other,changed]);
    const incoming = await message(changed,other);
    if (change==='human') await message(changed,other,'out','crm','sent');
    if (change==='cursor') await db.query('update wa_conversations set ai_last_processed_at=now() where id=$1',[changed]);
    if (change==='resume') {
      await db.query("update wa_conversations set ai_status='active',ai_status_changed_at=now(),ai_last_processed_at=now() where id=$1",[changed]);
      await db.query("insert into wa_ai_agent_runs(organization_id,conversation_id,trigger,status) values($1,$2,'resume','ok')",[other,changed]);
    }
    if (change==='bot_reply') await message(changed,other,'out','bot','sent');
    assert.deepEqual(await batch(changed),[],change);
    assert.equal((await state(incoming))[0].state,'cancelled',change);
    assert.deepEqual(await events(incoming),[],change);
  }
  const pendingBot = await conversation(other,'active',null);
  await db.query("insert into wa_bot_runs values($1,$2,'waiting_reply')",[other,pendingBot]);
  const pendingMessage = await message(pendingBot,other);
  const [pendingRun] = await batch(pendingBot);
  assert.equal(pendingRun.message_id,pendingMessage);
  assert.equal(await phase(pendingRun,'bots'),'ready');
  assert.equal(await finish(pendingRun,'done'),'done');
  // A prior turn assigned the agent and replied after a second inbound arrived.
  // Only the prior inbound was covered by the cursor. Run the second turn once.
  const assignedDuringWait = await conversation(other,null,null);
  await db.query("insert into wa_bot_runs values($1,$2,'waiting_reply')",[other,assignedDuringWait]);
  const older = await message(assignedDuringWait,other), [olderRun] = await immediate(older,assignedDuringWait,other);
  const newer = await message(assignedDuringWait,other);
  await db.query("update wa_conversations set ai_status='active',ai_status_changed_at=now(),ai_agent_id=$2,ai_last_processed_at=(select created_at from wa_messages where id=$3) where id=$1",[assignedDuringWait,agent,older]);
  await message(assignedDuringWait,other,'out','agent','sent');
  await db.query("insert into wa_ai_agent_runs(organization_id,conversation_id,trigger,status) values($1,$2,'inbound','ok')",[other,assignedDuringWait]);
  assert.equal(await finish(olderRun,'done'),'done');
  const [newerRun] = await batch(assignedDuringWait);
  assert.equal(newerRun.message_id,newer);
  assert.equal(await phase(newerRun,'bots'),'ready');
  assert.equal(await phase(newerRun,'bots',true),'ready');
  assert.equal(await phase(newerRun,'dispatch'),'ready');
  assert.equal(await finish(newerRun,'done'),'done');
  assert.deepEqual(await batch(assignedDuringWait),[]);
  // Changes after the lease is acquired are rechecked immediately before the bot.
  const changedInFlight = await message(pendingBot,other), [inFlight] = await batch(pendingBot);
  await message(pendingBot,other,'out','bot','sent');
  assert.equal(await phase(inFlight,'bots'),'cancelled');
  assert.equal((await state(changedInFlight))[0].reason,'already_answered');
  const slowWake = id(messageNumber++);
  await db.query("insert into wa_messages(id,organization_id,conversation_id,direction,wa_timestamp) values($1,$2,$3,'in',now()-interval '2 minutes')",[slowWake,other,bot]);
  assert.deepEqual(await immediate(slowWake,bot,other),[]);
  assert.equal((await state(slowWake))[0].reason,'manual_or_paused');
  const independent = await conversation(other,null,null);
  await db.query("insert into wa_bots values($1,true,'{\"type\":\"message_received\"}',array[$2::uuid],null)",[other,line]);
  assert.equal((await state(await message(independent,other)))[0].state,'pending');
  const both = await claimed();
  assert.equal(await phase(both.job,'bots'),'ready');
  await message(both.conv,org,'out','bot','sent');
  assert.equal(await phase(both.job,'bots',true),'ready');
  assert.equal(await phase(both.job,'started'),'ready');
  assert.equal(await phase(both.job,'started',true),'ready');
  assert.equal(await phase(both.job,'message_received'),'ready');
  assert.equal(await phase(both.job,'message_received',true),'ready');
  assert.equal(await phase(both.job,'dispatch'),'ready');
  assert.equal(await finish(both.job,'done'),'done');

  const interrupted = await claimed();
  assert.equal(await phase(interrupted.job,'message_received'),'ready');
  await dueNow(interrupted.mid);
  assert.deepEqual(await batch(interrupted.conv),[]);
  assert.equal((await state(interrupted.mid))[0].reason,'dispatch_uncertain');
  assert.equal((await events(interrupted.mid)).length,1);
  const proactive = await claimed();
  await message(proactive.conv,org,'out','agent','sent');
  assert.equal(await phase(proactive.job,'dispatch'),'ready');
  assert.equal(await finish(proactive.job,'review','dispatch_uncertain'),'review');
  assert.equal(await scalar("select crm_internal.wa_inbound_cancel_reason(w,'recovery',true) from wa_inbound_work w where message_id=$1",[proactive.mid]),null);
  const reviewer = id(600);
  await db.query("insert into profiles(id,organization_id,role) values($1,$2,'admin')",[reviewer,org]);
  const visible = mid => rows('select message_id from wa_entry_recovery_details($1,$2,array[$3::uuid])',[org,reviewer,mid]);
  for (const beforeLease of [true,false]) {
    const resumed = await conversation(), input = await message(resumed);
    const held = beforeLease ? null : (await batch(resumed))[0];
    await db.query("insert into wa_ai_agent_runs(organization_id,conversation_id,trigger,status) values($1,$2,'resume','error')",[org,resumed]);
    if (held) assert.equal(await phase(held,'bots'),'stale');
    assert.deepEqual(await batch(resumed),[]);
    assert.equal((await state(input))[0].reason,'dispatch_uncertain');
    assert.equal((await events(input)).length,1);
    assert.deepEqual(await visible(input),[{message_id:input}]);
    await message(resumed,org,'out','crm','sent');
    assert.deepEqual(await visible(input),[]);
  }
  for (const resolvedBy of ['cursor','operator']) {
    const partial = await claimed();
    assert.equal(await phase(partial.job,'dispatch'),'ready');
    const audio = await message(partial.conv,org,'out','agent','delivered');
    await db.query("update wa_messages set media_type='audio' where id=$1",[audio]);
    // The worker died before sending the promised link or recording the cursor.
    await dueNow(partial.mid);
    assert.deepEqual(await batch(partial.conv),[]);
    assert.equal((await state(partial.mid))[0].reason,'dispatch_uncertain');
    assert.equal((await events(partial.mid)).length,1);
    assert.deepEqual(await visible(partial.mid),[{message_id:partial.mid}]);
    assert.deepEqual(await batch(partial.conv),[]);
    if (resolvedBy==='cursor') await db.query('update wa_conversations set ai_last_processed_at=now() where id=$1',[partial.conv]);
    else await message(partial.conv,org,'out','crm','sent');
    assert.deepEqual(await visible(partial.mid),[]);
  }
  const safe = await claimed();
  // A prior proactive message sent after this inbound did not read it. The
  // cursor is still behind it, and no effect began in the interrupted claim.
  await message(safe.conv,org,'out','agent','sent');
  await dueNow(safe.mid);
  const [reclaimed] = await batch(safe.conv);
  assert.equal(reclaimed.attempts,2);
  assert.equal(await phase(safe.job,'dispatch'),'stale');
  assert.equal(await phase(reclaimed,'dispatch'),'ready');
  assert.equal(await finish(reclaimed,'done'),'done');

  // Suppress replay and escalation whenever the customer was served or the
  // conversation has changed. Rerunning the scheduler cannot create an alert.
  for (const change of ['human','processed','paused','group','delegated','newer']) {
    const item = await claimed();
    assert.equal(await phase(item.job,'dispatch'),'ready');
    if (change==='human') await message(item.conv,org,'out','crm','sent');
    if (change==='processed') await db.query('update wa_conversations set ai_last_processed_at=now() where id=$1',[item.conv]);
    if (change==='paused') await db.query("update wa_conversations set ai_status='paused',ai_status_changed_at=now() where id=$1",[item.conv]);
    if (change==='group') await db.query('update wa_conversations set is_group=true where id=$1',[item.conv]);
    if (change==='delegated') await db.query('insert into wa_agent_connection_pending values($1,$2,$3)',[org,item.conv,item.mid]);
    if (change==='newer') await message(item.conv);
    await dueNow(item.mid);
    await batch(item.conv);
    assert.equal((await state(item.mid))[0].state,'cancelled',change);
    assert.deepEqual(await events(item.mid),[],change);
  }
  const order = await conversation(), a = await message(order), b = await message(order);
  assert.deepEqual(await immediate(b,order),[]);
  const [next] = await batch(order,10);
  assert.equal((await state(a))[0].reason,'superseded');
  assert.equal(next.message_id,b);
  assert.deepEqual(await batch(order),[]);
  assert.equal(await finish(next,'done'),'done');
  const exhausted = await claimed();
  let current = exhausted.job;
  for (let attempt=1;attempt<=5;attempt++) {
    assert.equal(current.attempts,attempt);
    assert.equal(await finish(current,'retry','lock_busy'),attempt===5?'review':'pending');
    if (attempt<5) {
      await dueNow(exhausted.mid);
      [current] = await batch(exhausted.conv);
    }
  }
  assert.deepEqual((await state(exhausted.mid))[0],{state:'review',reason:'attempts_exhausted',attempts:5,last_failure:'lock_busy'});
  assert.equal((await events(exhausted.mid)).length,1);
  const stale = await conversation(), staleMid = await message(stale);
  await db.query("update wa_inbound_work set expires_at=now()-interval '1 minute' where message_id=$1",[staleMid]);
  assert.deepEqual(await batch(stale),[]);
  assert.equal((await state(staleMid))[0].reason,'expired');
  await db.query("update wa_inbound_work set finished_at=now()-interval '31 days' where message_id=$1",[staleMid]);
  await db.exec(cron);
  assert.deepEqual(await state(staleMid),[]);
  assert.equal(await scalar('select id from wa_messages where id=$1',[staleMid]),staleMid);
  for (const role of ['anon','authenticated']) {
    assert.equal(await scalar("select has_table_privilege($1,'wa_inbound_work','SELECT')",[role]),false);
    for (const rpc of ['claim_wa_inbound_work(uuid,integer,uuid,uuid)','advance_wa_inbound_work(uuid,uuid,text,boolean)','finish_wa_inbound_work(uuid,uuid,text,text)']) {
      assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,rpc]),false);
    }
  }
  await db.exec('set role service_role');
  assert.deepEqual(await immediate(mid,conv),[]);
  await db.exec('reset role');
  console.log('Verified durable admission, claim scope, FIFO, phase fencing, retry limits, terminal notifications, cancellation, retention and grants.');
} finally {
  await db.close();
}
