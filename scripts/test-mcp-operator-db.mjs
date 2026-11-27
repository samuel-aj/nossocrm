// Usage: node scripts/test-mcp-operator-db.mjs <local PostgreSQL bin directory>
// The test initializes its own server. It never accepts a database URL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';

const mig = 'supabase/migrations/20261127203007_aj_operator_keys.sql';
const rollback = 'docs/aj-operator-keys-rollback.sql';
const load = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const hash = value => createHash('sha256').update(value).digest('hex');

async function scenarios(db, service) {
  const value = async (client, query, params = []) =>
    (await client.query({ text: query, values: params, rowMode: 'array' })).rows[0]?.[0];
  const scalar = (query, params = []) => value(db, query, params);
  const sql = await load(mig);
  const undo = await load(rollback);
  await db.query(await load('supabase/tests/mcp_ai_agents.fixture.sql'));
  await db.query(await load('supabase/migrations/20261126210000_mcp_ai_agents.sql'));
  await db.query(await load('supabase/tests/aj_operator.fixture.sql'));
  await service.query('set role service_role');

  const org = id(1), orgB = id(2), inactiveOrg = id(3);
  const a = id(10), off = id(11), b = id(12), ignored = id(13), sameOrgAgent = id(14);
  const owner = id(20), legacy = id(40), normal = id(41);
  const token = 'ncrmop_' + randomBytes(24).toString('base64url');
  const legacyToken = 'ncrm_' + randomBytes(24).toString('base64url');
  const normalToken = 'ncrm_' + randomBytes(24).toString('base64url');
  await db.query("insert into organizations(id,name) values($1,'A'),($2,'B'),($3,'Inactive')", [org, orgB, inactiveOrg]);
  await db.query("insert into profiles(id,role) values($1,'super_admin')", [owner]);
  await db.query(
    "insert into api_keys(id,organization_id,key_hash,key_prefix,scopes) values($1,$2,$3,$4,null),($5,$2,$6,$7,array['ai_agents:read'])",
    [legacy,org,hash(legacyToken),legacyToken.slice(0,12),normal,hash(normalToken),normalToken.slice(0,12)]
  );
  for (const [agent, tenant, enabled] of [[a,org,true],[off,org,false],[b,orgB,true],[ignored,inactiveOrg,true],[sameOrgAgent,org,true]]) {
    await db.query('insert into wa_ai_agents(id,name,organization_id,squad_monitoring,system_prompt,stop_rules) values($1,$2,$3,$4,$5,$6)',
      [agent, 'Fixture ' + agent.slice(-2), tenant, enabled, 'PRIVATE-PROMPT-' + agent.slice(-2), 'PRIVATE-RULES']);
  }
  await db.query("insert into ai_feature_flags values ($1,'wa_ai_agents_approved',true),($2,'wa_agents_beta',true),($3,'wa_ai_agents_approved',false)", [org,orgB,inactiveOrg]);
  await db.query("update wa_ai_agents set system_prompt='PRIVATE-PROMPT-B-EDIT' where id=$1",[b]);

  async function verifyLegacyAuth() {
    assert.equal(await scalar('select organization_id from validate_mcp_api_key($1)',[normalToken]),org);
    assert.equal(await scalar('select organization_id from validate_api_key($1)',[legacyToken]),org);
    assert.equal(await scalar('select count(*)::int from validate_api_key($1)',[normalToken]),0);
    for (const fn of ['validate_api_key','validate_mcp_api_key']) {
      assert.equal(await scalar('select count(*)::int from ' + fn + '($1)',[token]),0);
    }
    await assert.rejects(service.query('select wa_ai_agent_prompt_snapshot($1,$2)', [org,b]), {code:'P0002'});
  }
  const versionCount = () => scalar('select count(*)::int from wa_ai_agent_prompt_versions');
  await verifyLegacyAuth();
  const existingVersions = await versionCount();
  assert.equal(existingVersions, 2);
  await db.query(sql);
  await verifyLegacyAuth();

  const permissions = ['anon','authenticated'];
  for (const role of permissions) {
    await db.query('set role ' + role);
    try {
      for (const statement of [
        'select key_hash from aj_operator_keys',
        'select * from aj_operator_audit',
        "insert into aj_operator_keys(name,key_prefix,key_hash,created_by) values('Unauthorized','x','x',null)",
        "select aj_operator_authenticate('x')",
        "select aj_operator_read(null,'crm.ai_agents.list','{}')",
      ]) await assert.rejects(db.query(statement), {code:'42501'});
    } finally { await db.query('reset role'); }
  }
  await assert.rejects(service.query('select key_hash from aj_operator_keys'), {code:'42501'});
  await assert.rejects(service.query('delete from aj_operator_audit'), {code:'42501'});
  assert.equal(await scalar("select count(*)::int from pg_class where oid in ('public.aj_operator_keys'::regclass,'public.aj_operator_audit'::regclass) and relrowsecurity"), 2);

  const key = await value(service,
    'insert into aj_operator_keys(name,key_prefix,key_hash,created_by) values($1,$2,$3,$4) returning id',
    ['Synthetic operator',token.slice(0,12),hash(token),owner]);
  const auth = secret => value(service, 'select aj_operator_authenticate($1)', [hash(secret)]);
  assert.equal(await auth(token),key);
  assert.equal(await auth(normalToken),null);
  assert.ok(await scalar('select last_used_at is not null from aj_operator_keys where id=$1',[key]));
  const call = (tool,args={}) => value(service, 'select aj_operator_read($1,$2,$3::jsonb)',[key, 'crm.ai_agents.' + tool, JSON.stringify(args)]);
  const ok = async (tool,args) => {
    const response=await call(tool,args);
    assert.ok(response && !response.error, tool + ' returned ' + response?.code);
    return response;
  };
  const denied = async (tool,args) => {
    const response=await call(tool,args);
    assert.equal(typeof response?.error,'string', tool + ' was not denied');
    assert.deepEqual(Object.keys(response).sort(),['code','error']);
    return response.code;
  };

  const catalog = await ok('list');
  assert.deepEqual(catalog.agents.map(row=>row.id).sort(),[a,off,b,sameOrgAgent].sort());
  assert.deepEqual(catalog.agents.find(row=>row.id===off), {
    id:off, name:'Fixture 11', organization_id:org, organization_name:'A', squad_monitoring:false,
  });
  assert.ok(catalog.agents.every(row=>Object.keys(row).sort().join(',')==='id,name,organization_id,organization_name,squad_monitoring'));
  const auditOrganizations=(await db.query('select distinct organization_id from aj_operator_audit where key_id=$1 and tool=$2 order by organization_id',
    [key,'crm.ai_agents.list'])).rows.map(row=>row.organization_id);
  assert.deepEqual(auditOrganizations,[org,orgB]);
  const page = await ok('list',{limit:2});
  assert.deepEqual(page.agents.map(row=>row.id),[a,off]);
  assert.deepEqual((await ok('list',{afterId:page.nextCursor,limit:2})).agents.map(row=>row.id),[b,sameOrgAgent]);
  for (const inactiveState of ['is_active=false','deleted_at=now()']) {
    await db.query('update organizations set ' + inactiveState + ' where id=$1',[orgB]);
    assert.ok((await ok('list')).agents.every(row=>row.organization_id!==orgB));
    await denied('get',{agentId:b});
    assert.ok(await scalar("select exists(select 1 from aj_operator_audit where key_id=$1 and organization_id=$2 and agent_id=$3 and outcome='denied')", [key,orgB,b]));
    await db.query('update organizations set is_active=true,deleted_at=null where id=$1',[orgB]);
  }

  for (const target of [off,ignored,id(99)]) {
    for (const [tool,extra] of [['get',{}],['versions.list',{}],['versions.get',{version:0}],
      ['conversations',{from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z'}],['transcript',{conversationId:id(100)}]]) {
      await denied(tool,{agentId:target,...extra});
    }
  }
  assert.equal((await ok('get',{agentId:a})).system_prompt,'PRIVATE-PROMPT-10');
  const virtual = await ok('versions.get',{agentId:a,version:0});
  assert.equal(virtual.revision.system_prompt,'PRIVATE-PROMPT-10');
  assert.equal(virtual.revision.source,'original');
  assert.equal((await ok('versions.list',{agentId:a})).versions.length,1);
  assert.equal((await ok('versions.get',{agentId:b,version:1})).revision.system_prompt,'PRIVATE-PROMPT-B-EDIT');
  await denied('versions.get',{agentId:a,version:1});
  await denied('get',{agentId:a,organizationId:orgB});
  for (const tool of ['prompt.update','prompt.restore']) await denied(tool,{agentId:a,expectedVersion:0});
  const oldKeyRead=await value(service,'select aj_operator_read($1,$2,$3::jsonb)',[normal,'crm.ai_agents.get',JSON.stringify({agentId:b})]);
  assert.equal(typeof oldKeyRead?.error,'string');

  const from = '2026-11-01T00:00:00Z', to='2026-11-02T00:00:00Z';
  const c=id(100),mixedOff=id(101),mixedOn=id(102), foreign=id(103), simulated=id(104);
  const unassignedHumanChat = id(105);
  const reassignedToExternal = id(106);
  for (const [conv,tenant,primary] of [[c,org,a],[mixedOff,org,a],[mixedOn,org,a],[foreign,orgB,b],[simulated,org,a]]) {
    await db.query("insert into wa_conversations(id,organization_id,ai_agent_id,ai_status,wa_phone) values($1,$2,$3,'active','00000000001234')",[conv,tenant,primary]);
    await db.query("insert into wa_ai_agent_runs(agent_id,conversation_id,organization_id,created_at,trigger,status,output_text) values($1,$2,$3,$4,$5,'ok','Synthetic answer')",
      [primary,conv,tenant,from,conv===simulated?'test':'inbound']);
  }
  for (const [conv,agent] of [[mixedOff,off],[mixedOn,sameOrgAgent]]) {
    await db.query("insert into wa_ai_agent_runs(agent_id,conversation_id,organization_id,created_at,trigger,status,output_text) values($1,$2,$3,$4,'inbound','ok','Synthetic')",[agent,conv,org,from]);
  }
  await db.query("insert into wa_conversations(id,organization_id,ai_agent_id) values($1,$2,null)",
    [unassignedHumanChat,org]);
  await db.query("insert into wa_messages(id,organization_id,conversation_id,created_at,direction,source,sent_by,body) values($1,$2,$3,$4,'out','crm',$5,'PRIVATE-HUMAN-HISTORY')",
    [id(202),org,unassignedHumanChat,from,owner]);
  await db.query("insert into wa_ai_agent_runs(agent_id,conversation_id,organization_id,created_at,trigger,status,output_text) values($1,$2,$3,$4,'inbound','skipped',null)",
    [a,unassignedHumanChat,org,from]);
  await db.query("insert into wa_conversations(id,organization_id,ai_agent_id) values($1,$2,$3)",
    [reassignedToExternal,org,a]);
  await db.query("insert into wa_ai_agent_runs(agent_id,conversation_id,organization_id,created_at,trigger,status,output_text) values($1,$2,$3,$4,'inbound','ok','Former native agent response')",
    [a,reassignedToExternal,org,from]);
  await db.query('update wa_conversations set ai_agent_id=null where id=$1',[reassignedToExternal]);
  const afterTransfer = await ok('conversations',{agentId:a,from,to});
  assert.ok(afterTransfer.conversations.every(row=>row.conversation_id!==reassignedToExternal));
  await denied('transcript',{agentId:a,conversationId:reassignedToExternal});
  await db.query("insert into wa_messages(id,organization_id,conversation_id,created_at,direction,source,body) values($1,$2,$3,$4,'out','api','PRIVATE-EXTERNAL-AGENT')",
    [id(203),org,reassignedToExternal,to]);
  await db.query("insert into wa_messages(id,organization_id,conversation_id,created_at,direction,body) values ($1,$2,$3,$4,'in','PRIVATE-TEXT 00000000001234'),($5,$2,$3,$4,'out','Synthetic response')",
    [id(200),org,c,from,id(201)]);
  const report=await ok('conversations',{agentId:a,from,to});
  assert.ok(report.conversations.some(row=>row.conversation_id===c));
  const inaccessibleConversations = [mixedOff,mixedOn,foreign,simulated,unassignedHumanChat,reassignedToExternal];
  assert.ok(report.conversations.every(row=>!inaccessibleConversations.includes(row.conversation_id)));
  for (const conv of inaccessibleConversations) await denied('transcript',{agentId:a,conversationId:conv});
  // Even a current assignment back to the native agent cannot attribute the external history to it.
  await db.query('update wa_conversations set ai_agent_id=$1 where id=$2',[a,reassignedToExternal]);
  for (const deletedAt of [null,to]) {
    await db.query('update wa_messages set deleted_at=$1 where id=$2',[deletedAt,id(203)]);
    const current = await ok('conversations',{agentId:a,from,to});
    assert.ok(current.conversations.every(row=>row.conversation_id!==reassignedToExternal));
    await denied('transcript',{agentId:a,conversationId:reassignedToExternal});
  }
  const first=await ok('transcript',{agentId:a,conversationId:c,limit:1});
  assert.equal(first.messages.length,1);
  assert.ok(first.nextCursor);
  assert.ok(!JSON.stringify(first).includes('00000000001234'));
  assert.match(first.messages[0].text, /PRIVATE-TEXT/);
  assert.equal((await ok('transcript',{agentId:a,conversationId:c,after:first.nextCursor,limit:1})).messages[0].id,id(201));
  await db.query('update wa_ai_agents set squad_monitoring=false where id=$1',[a]);
  await denied('transcript',{agentId:a,conversationId:c,after:first.nextCursor,limit:1});
  await denied('get',{agentId:a});
  assert.equal(await versionCount(),existingVersions);
  assert.equal(await scalar('select system_prompt from wa_ai_agents where id=$1',[a]), 'PRIVATE-PROMPT-10');
  assert.equal(await scalar('select squad_monitoring from wa_ai_agents where id=$1',[off]),false);
  const auditRows=(await db.query("select to_jsonb(log) as record from aj_operator_audit log where key_id=$1",[key])).rows;
  assert.ok(auditRows.some(row=>row.record.agent_id===a && row.record.organization_id===org));
  for(const marker of ['PRIVATE-PROMPT','PRIVATE-TEXT','PRIVATE-RULES','00000000001234',hash(token),token]){
    assert.ok(!JSON.stringify(auditRows).includes(marker), 'Audit contained sensitive fixture data');
  }
  // A read whose audit write fails must never return its payload.
  await db.query(`create function reject_test_audit() returns trigger language plpgsql as $$
     begin raise exception 'fixture audit unavailable'; end; $$;
     create trigger reject_test_audit before insert on aj_operator_audit
     for each row execute function reject_test_audit();`);
  await assert.rejects(call('get',{agentId:b}), {code:'P0001'});
  await db.query('drop trigger reject_test_audit on aj_operator_audit; drop function reject_test_audit()');

  // A read arriving during a revoke must wait and see the committed revocation.
  await db.query('begin');
  await db.query('set local role service_role');
  await db.query('update aj_operator_keys set revoked_at=now(), revoked_by=$2 where id=$1',[key,owner]);
  const concurrentRead=call('get',{agentId:b});
  try {
    let waits=false;
    for (let n=0;n<50 && !waits;n++) {
      waits=await scalar('select pg_backend_pid()=any(pg_blocking_pids($1))',[service.processID]);
      if (!waits) await new Promise(done=>setTimeout(done,20));
    }
    assert.ok(waits,'the read did not wait for revocation');
  } finally { await db.query('commit'); }
  assert.equal((await concurrentRead).code,'AUTH_INVALID');
  assert.equal(await auth(token),null);
  await denied('get',{agentId:b});
  await denied('list');
  const deletedProfile = await db.query('delete from profiles where id=$1 returning id',[owner]);
  assert.equal(deletedProfile.rowCount,1);
  const history = await service.query('select created_by, revoked_by, revoked_at from aj_operator_keys where id=$1',[key]);
  assert.equal(history.rows[0].created_by,owner);
  assert.equal(history.rows[0].revoked_by,owner);
  assert.ok(history.rows[0].revoked_at);
  await verifyLegacyAuth();
  const audits=await scalar('select count(*)::int from aj_operator_audit');
  await db.query(undo);
  assert.equal(await scalar("select to_regclass('public.aj_operator_keys')::text"),null);
  assert.equal(await scalar("select to_regprocedure('public.aj_operator_read(uuid,text,jsonb)')::text"),null);
  assert.equal(await scalar('select count(*)::int from aj_operator_audit'),audits);
  await verifyLegacyAuth();
  assert.equal(await versionCount(),existingVersions);
  await db.query(sql);
  assert.equal(await scalar('select count(*)::int from aj_operator_audit'),audits);
  assert.equal(await auth(token),null);
  await verifyLegacyAuth();
}

if (!process.argv[2]) throw new Error('Pass the local PostgreSQL bin directory.');
const bin=resolve(process.argv[2]);
const dir=await mkdtemp(join(tmpdir(),'crm-operator-pg-'));
const data=join(dir,'data'), pwfile=join(dir,'pw');
const secret=randomBytes(32).toString('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG|DATABASE_URL|SUPABASE/i.test(key)));
const run=(name,args)=>execFileSync(join(bin,name+(process.platform==='win32'?'.exe':'')),args,
  { env,windowsHide:true,stdio:name==='pg_ctl'?'ignore':'pipe',timeout:90_000 });
const clients=[];
let started=false;
try {
  const listener=createServer();
  const port=await new Promise((yes,no)=>{
    listener.once('error',no);
    listener.listen(0,'127.0.0.1',()=>{
      const port=listener.address().port;
      listener.close(err=>err?no(err):yes(port));
    });
  });
  await writeFile(pwfile,secret,{mode:0o600});
  run('initdb',['-D',data,'-U','operator_fixture','--pwfile',pwfile,'-A','scram-sha-256','--no-sync','--locale=C','-E','UTF8']);
  await rm(pwfile);
  run('pg_ctl',['-D',data,'-l',join(dir,'server.log'),'-o','-h 127.0.0.1 -p '+port+' -c max_connections=8','-w','start']);
  started=true;
  for(let n=0;n<2;n++){
    const c=new pg.Client({host:'127.0.0.1',port,user:'operator_fixture',database:'postgres',password:secret,
      connectionTimeoutMillis:5000,statement_timeout:10_000});
    await c.connect();
    clients.push(c);
  }
  const server=await clients[0].query("select current_setting('data_directory') as path, host(inet_server_addr()) as ip, current_setting('server_version') as version");
  assert.equal(server.rows[0].ip,'127.0.0.1');
  assert.equal(await realpath(server.rows[0].path),await realpath(data));
  await scenarios(clients[0],clients[1]);
  process.stdout.write('PASS PostgreSQL '+server.rows[0].version+' on loopback: operator isolation, permissions, six reads, opt-in, transcripts, revocation, audit, legacy compatibility, rollback and reapply.\n');
} finally {
  await Promise.allSettled(clients.map(c=>c.end()));
  if (started) run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  const owned=await realpath(dir);
  assert.equal(dirname(owned),await realpath(tmpdir()));
  assert.ok(basename(owned).startsWith('crm-operator-pg-'));
  await rm(owned,{recursive:true});
}
