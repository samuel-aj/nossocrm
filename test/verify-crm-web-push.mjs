// Run only against isolated PostgreSQL/WASM. No sockets, real messages or push subscription data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const file = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await query(sql, args))[0])[0];
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const [orgA, orgB, ana, bia, master, individual, group] = [1,2,3,4,5,6,7].map(id);
const endpoint = 'https://push.invalid/unit-test';
const register = (org, user, key = 'key') => scalar(
  'select register_crm_push_subscription($1,$2,$3,$4,$5)',[org,user,endpoint,key,'auth']);
const role = (org, user) => scalar('select crm_push_recipient_role($1,$2)',[org,user]);
const claim = () => query('select * from claim_crm_push_deliveries(24)');
const finish = (job, outcome) => scalar('select finish_crm_push_delivery($1,$2,$3)',[job.id,job.lease_token,outcome]);
const message = (index, conversation = individual, direction = 'in', ageMinutes = 0) => query(
  "insert into wa_messages(id,conversation_id,organization_id,direction,body,wa_timestamp) values($1,$2,$3,$4,'texto fictício',now()-$5::integer*interval '1 minute')",
  [id(index), conversation, orgA, direction, ageMinutes]);

try {
  await db.exec(await file('supabase/tests/crm_web_push.fixture.sql'));
  await db.exec(await file('supabase/migrations/20260918020850_personal_notifications.sql'));
  await db.exec(await file('supabase/migrations/20261124202850_crm_web_push.sql'));
  await query('insert into organizations values ($1,true),($2,true)', [orgA,orgB]);
  await query('insert into auth.users(id) values ($1),($2),($3)', [ana,bia,master]);
  await query("insert into profiles values ($1,$2,'vendedor'),($3,$2,'admin'),($4,$2,'super_admin')", [ana,orgA,bia,master]);
  await query("insert into user_organizations values ($1,$2,'gestor')", [ana,orgB]);
  await query('insert into wa_conversations values ($1,$2,false),($3,$2,true)', [individual,orgA,group]);
  await query("insert into platform_config values ('wa_agents_app_url','https://fake.invalid'),('wa_agents_internal_secret','fixture')");
  assert.equal(await role(orgA,ana),'vendedor'); // Primary-org fallback.
  assert.equal(await role(orgB,ana),'gestor');
  assert.equal(await role(orgB,master),'super_admin');
  assert.equal(await role(orgB,bia),null);
  await assert.rejects(register(orgB,bia), e => e.code === '42501');
  await query('update organizations set is_active=false where id=$1',[orgB]);
  assert.equal(await role(orgB,master),null);
  await query('update organizations set is_active=true where id=$1',[orgB]);
  await query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[ana]);
  assert.equal(await role(orgA,ana),null);
  await query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[ana]);
  assert.equal(await role(orgA,ana),null);
  await query('update auth.users set deleted_at=null where id=$1',[ana]);

  const sub = await register(orgA,ana);
  assert.equal(await register(orgA,ana),sub);
  assert.equal(await scalar('select endpoint_hash from crm_push_subscriptions where id=$1',[sub]),createHash('sha256').update(endpoint).digest('hex'));
  const otherOffice = await register(orgB,ana);
  assert.notEqual(otherOffice,sub);
  await message(10); // Default preference disables message alerts.
  assert.deepEqual(await claim(),[]);
  await query("insert into crm_notification_preferences(organization_id,user_id,preferences) values ($1,$2,'{\"messages\":true,\"scope\":\"own\"}'::jsonb)",[orgA,ana]);
  await message(11,group);
  await message(12,individual,'out');
  await message(13,individual,'in',10);
  assert.deepEqual(await claim(),[]);
  assert.equal(await scalar('select count(*)::int from net.requests'),0);

  await message(14);
  await query("insert into crm_notification_events(organization_id,kind,source_id) values ($1,'message',$2)",[orgA,id(14)]);
  const [job] = await claim();
  assert.equal(job.organization_id,orgA);
  assert.equal(job.subscription_id,sub);
  assert.equal(job.user_id,ana);
  assert.equal(job.message_id,id(14));
  assert.equal(typeof job.event_id,'string');
  assert.deepEqual(await claim(),[]); // No parallel dispatch of the same leased delivery.
  assert.deepEqual(await query('select url,body from net.requests'),[
    {url:'https://fake.invalid/api/notifications/push/dispatch',body:{ job:'web_push' }},
  ]);
  assert.equal(await finish(job,'retry'),true);
  assert.equal(await finish(job,'gone'),false);
  assert.deepEqual(await claim(),[]); // Respect the backoff.
  await query("update crm_push_deliveries set available_at=now()-interval '1 second' where id=$1",[job.id]);
  const [next] = await claim();
  assert.notEqual(job.lease_token,next.lease_token);
  assert.equal(await finish(next,'sent'),true);
  assert.deepEqual(await claim(),[]);

  await message(15);
  const [obsolete] = await claim();
  const rotated = await register(orgA,ana,'new-key');
  assert.notEqual(rotated,sub);
  assert.equal(await finish(obsolete,'gone'),false); // Late HTTP 410 cannot revoke a renewed subscription.
  assert.equal(await scalar('select count(*)::int from crm_push_subscriptions'),2);
  const replacement = await register(orgA,bia); // Logout/login by a different user on the same browser.
  assert.deepEqual(await query('select id,user_id from crm_push_subscriptions'),[{ id:replacement, user_id:bia }]);
  assert.equal(await scalar('select count(*)::int from crm_push_deliveries'),0);
  await query("insert into crm_notification_preferences(organization_id,user_id,preferences) values ($1,$2,'{\"messages\":true,\"scope\":\"all\"}'::jsonb)",[orgA,bia]);
  await message(16);
  const [expired] = await claim();
  assert.equal(await finish(expired,'gone'),true);
  assert.equal(await scalar('select count(*)::int from crm_push_subscriptions'),0);

  const cron = await scalar("select command from cron.jobs where name='crm-web-push' and schedule='* * * * *'");
  const wakes = await scalar('select count(*)::int from net.requests');
  await db.exec(cron);
  assert.equal(await scalar('select count(*)::int from net.requests'),wakes);
  await register(orgA,bia);
  await query("delete from platform_config where key='wa_agents_internal_secret'");
  await message(17);
  assert.equal(await scalar('select count(*)::int from net.requests'),wakes);
  await query("insert into platform_config values ('wa_agents_internal_secret','restored-fixture')");
  await db.exec(cron); // A missed direct wakeup is recoverable without replaying the message.
  assert.equal(await scalar('select count(*)::int from net.requests'),wakes+1);
  const [timedOut] = await claim();
  await query("update crm_push_deliveries set available_at=now()-interval '1 second',lease_until=available_at-interval '10 minutes' where id=$1",[timedOut.id]);
  const [reclaimed] = await claim();
  assert.notEqual(reclaimed.lease_token,timedOut.lease_token);
  assert.equal(await finish(timedOut,'gone'),false);
  assert.equal(await finish(reclaimed,'skip'),true);
  await message(18);
  await query("update crm_push_deliveries set created_at=now()-interval '25 hours' where message_id in ($1,$2)",[id(17),id(18)]);
  assert.deepEqual(await claim(),[]);
  await db.exec(cron);
  assert.equal(await scalar('select count(*)::int from crm_push_deliveries where message_id in ($1,$2)',[id(17),id(18)]),0);
  await db.exec(`create function break_push_fixture() returns trigger language plpgsql as $$
    begin raise exception 'simulated queue insert error'; end $$;
    create trigger break_push before insert on crm_push_deliveries for each row execute function break_push_fixture()`);
  await message(20);
  assert.equal(await scalar('select count(*)::int from wa_messages where id=$1',[id(20)]),1);
  assert.equal(await scalar("select count(*)::int from crm_notification_events where source_id=$1 and kind='message'",[id(20)]),1);
  assert.deepEqual(await claim(),[]);
  await db.exec('drop trigger break_push on crm_push_deliveries');
  await message(19);
  for (const dbRole of ['anon','authenticated']) {
    await db.exec('set role ' + dbRole);
    await assert.rejects(query('select * from crm_push_subscriptions'), e => e.code === '42501');
    await assert.rejects(query('select * from crm_push_deliveries'), e => e.code === '42501');
    await assert.rejects(claim(), e => e.code === '42501');
    await assert.rejects(register(orgA,ana), e => e.code === '42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await claim()).length,1);
  console.log('Web Push SQL: cadastro/escopo, expiração, fila, wakeup, deduplicação, retry, revogação e permissões passaram em banco em memória.');
} finally {
  await db.close();
}
