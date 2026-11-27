// Usage: node scripts/test-mcp-ai-agents-db.mjs <local PostgreSQL bin directory>
// Starts a fresh, password-protected cluster bound only to loopback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';

if (!process.argv[2]) throw new Error('Pass the local PostgreSQL bin directory.');
const bin = resolve(process.argv[2]);
const dir = await mkdtemp(join(tmpdir(), 'crm-agent-squad-pg-'));
const data = join(dir, 'data');
const secret = randomBytes(32).toString('hex');
const passwordFile = join(dir, 'pw');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG|DATABASE_URL|SUPABASE/i.test(key)));
const run = (name, args) => execFileSync(join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, {
  env, windowsHide: true, stdio: name === 'pg_ctl' ? 'ignore' : 'pipe', timeout: 90000,
});
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const chosen = server.address().port;
    server.close(error => error ? reject(error) : resolvePort(chosen));
  });
});
const clients = [];
const connect = async () => {
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'squad_test', database: 'postgres', password: secret,
    statement_timeout: 10000, connectionTimeoutMillis: 5000 });
  await client.connect();
  clients.push(client);
  return client;
};
const sql = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const migration = await sql('supabase/migrations/20261126210000_mcp_ai_agents.sql');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let started = false;
let passed = false;
try {
  await writeFile(passwordFile, secret, { mode: 0o600 });
  run('initdb',['-D',data,'-U','squad_test','--pwfile',passwordFile,'-A','scram-sha-256','--no-sync','--locale=C','-E','UTF8']);
  run('pg_ctl',['-D',data,'-l',join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=12`,'-w','start']);
  started = true;
  const d = await connect();
  const scalar = async (query, params = [], client = d) => (await client.query({ text: query, values: params, rowMode: 'array' })).rows[0]?.[0];
  const cluster = await scalar("select current_setting('data_directory')");
  assert.equal(await realpath(cluster), await realpath(data));
  assert.equal(await scalar('select host(inet_server_addr())'), '127.0.0.1');
  await d.query(await sql('supabase/tests/mcp_ai_agents.fixture.sql'));
  const org = id(1), other = id(2), agent = id(10), privateAgent = id(11), person = id(20), conv = id(30);
  const full = id(40), reader = id(41), writer = id(42), foreign = id(43);
  await d.query("insert into organizations values ($1,'A'),($2,'B')",[org,other]);
  await d.query("insert into api_keys(id,organization_id,key_prefix,key_hash) values ($1,$2,'old',encode(sha256(convert_to('old','UTF8')),'hex'))",[full,org]);
  await d.query("insert into wa_ai_agents(id, organization_id, system_prompt, stop_rules) values ($1,$3,'original','stop'),($2,$3,'private','stop')",[agent,privateAgent,org]);
  await d.query(migration);
  await d.query(migration);
  assert.equal(await scalar('select scopes from api_keys where id=$1',[full]),null);
  assert.equal(await scalar('select bool_or(squad_monitoring) from wa_ai_agents'),false);
  await d.query('insert into profiles values ($1)',[person]);
  await d.query('update wa_ai_agents set squad_monitoring=true where id=$1',[agent]);
  for (const [key,tenant,token,scopes] of [
    [reader,org,'monitor',['ai_agents:read']], [writer,org,'writer',['ai_agents:read','ai_agents:write_prompt']],
    [foreign,other,'other',['ai_agents:read','ai_agents:write_prompt']],
  ]) await d.query("insert into api_keys(id,organization_id,key_prefix,key_hash,scopes) values ($1,$2,$3,encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[key,tenant,token,scopes]);
  const rejectCode = (promise,code) => assert.rejects(promise,error => error.code === code);
  await rejectCode(d.query("update api_keys set scopes=ARRAY['invalid'] where id=$1",[reader]),'23514');
  await d.query('set role anon');
  assert.equal(await scalar("select count(*)::int from validate_api_key('old')"),1);
  assert.equal(await scalar("select count(*)::int from validate_api_key('monitor')"),0);
  assert.equal(await scalar("select count(*)::int from validate_api_key('writer')"),0);
  assert.equal(await scalar("select scopes from validate_mcp_api_key('old')"),null);
  assert.deepEqual(await scalar("select scopes from validate_mcp_api_key('monitor')"),['ai_agents:read']);
  for (const role of ['anon','authenticated']) {
    await d.query('reset role');
    await d.query('set role ' + role);
    await rejectCode(d.query('select * from wa_ai_agent_prompt_versions'),'42501');
    await rejectCode(d.query('select wa_ai_agent_prompt_snapshot($1,$2)',[org,agent]),'42501');
  }
  await d.query('reset role');
  const a = await connect(), b = await connect();
  await Promise.all([a.query('set role service_role'), b.query('set role service_role')]);
  const snapshot = (client, target = agent, tenant = org) => scalar('select wa_ai_agent_prompt_snapshot($1,$2)',[tenant,target],client);
  const change = (client,expected,prompt,restore = null,key = writer,target = agent) =>
    scalar("select wa_ai_agent_prompt_change($1,$2,$3,$4,'tested','TASK/approval',$5,null,$6)",[org,target,key,expected,prompt,restore],client);
  const expectBlocked = async client => {
    for (let i = 0; i < 60; i++) {
      if (await scalar('select cardinality(pg_blocking_pids($1)) > 0',[client.processID])) return;
      await new Promise(done => setTimeout(done, 30));
    }
    throw new Error('concurrent writer did not wait for the first transaction');
  };
  await a.query('begin');
  assert.equal(await snapshot(a),0);
  const baselineRace = snapshot(b);
  await expectBlocked(b);
  await a.query('commit');
  assert.equal(await baselineRace,0);
  assert.equal(await scalar('select count(*)::int from wa_ai_agent_prompt_versions'),1);
  await rejectCode(snapshot(b,privateAgent),'P0002');
  await rejectCode(snapshot(b,agent,other),'P0002');
  assert.deepEqual((await b.query('select version from wa_ai_agent_prompt_snapshots($1,$2) order by agent_id',[org,[agent,privateAgent]])).rows,[{version:0},{version:0}]);
  await rejectCode(change(b,0,'no',null,reader),'42501');
  await rejectCode(change(b,0,'no',null,foreign),'42501');
  await rejectCode(change(b,0,'no',null,writer,privateAgent),'P0002');
  await a.query('begin');
  assert.equal(await change(a,0,'first'),1);
  const stale = rejectCode(change(b,0,'stale'),'40001');
  await expectBlocked(b);
  await a.query('commit');
  await stale;
  await b.query("select set_config('request.headers', $1, false)",[JSON.stringify({'x-crm-prompt-editor':person})]);
  await b.query("update wa_ai_agents set stop_rules='changed' where id=$1",[agent]);
  await b.query("update wa_ai_agents set stop_rules='changed' where id=$1",[agent]);
  assert.equal(await scalar("select created_by from wa_ai_agent_prompt_versions where agent_id=$1 and source='manual'",[agent]),person);
  assert.equal(await change(a,2,null,0),3);
  assert.deepEqual((await d.query('select system_prompt,stop_rules from wa_ai_agents where id=$1',[agent])).rows,[{system_prompt:'original',stop_rules:'stop'}]);
  assert.deepEqual((await d.query('select source from wa_ai_agent_prompt_versions where agent_id=$1 order by version',[agent])).rows.map(row=>row.source),['original','squad','manual','restore']);
  await rejectCode(change(b,3,null,55),'P0002');
  await b.query("update wa_ai_agents set system_prompt='manually edited before first read' where id=$1",[privateAgent]);
  assert.equal(await scalar('select system_prompt from wa_ai_agent_prompt_versions where agent_id=$1 and version=0',[privateAgent]),'private');

  const from='2026-11-01T00:00:00Z', to='2026-11-03T00:00:00Z';
  await d.query("insert into wa_conversations(id,organization_id,ai_agent_id,ai_status) values($1,$2,$3,'active'),($4,$2,$3,'active'),($5,$6,$3,'active')",[conv,org,agent,id(31),id(32),other]);
  for (const [conversation,trigger,status,output] of [[conv,'inbound','ok','A'],[conv,'resume','skipped',null],[id(31),'test','ok','x'],[id(32),'inbound','ok','y']])
    await d.query('insert into wa_ai_agent_runs values($1,$2,$3,$4,$5,$6,$7)',[agent,conversation,org,from,trigger,status,output]);
  await b.query("update wa_conversations set ai_status='paused', ai_paused_by=$2,ai_status_changed_at=$3 where id=$1",[conv,person,from]);
  await b.query("update wa_conversations set ai_status='active', ai_paused_by=null where id=$1",[conv]);
  const conversations = (await b.query('select * from wa_ai_agent_conversations($1,$2,$3,$4)',[org,agent,from,to])).rows;
  assert.equal(conversations.length,1);
  assert.equal(conversations[0].conversation_id,conv);
  assert.equal(conversations[0].response_count,'1');
  assert.equal(conversations[0].human_paused,true);
  assert.equal(conversations[0].ai_status,'active');
  await rejectCode(b.query('select * from wa_ai_agent_conversations($1,$2,$3,$4)',[org,privateAgent,from,to]),'P0002');
  await rejectCode(b.query('select * from wa_ai_agent_conversations($1,$2,$3,$4)',[org,agent,from,'2026-12-01']),'22023');
  await d.query('update api_keys set revoked_at=now() where id=$1',[reader]);
  assert.equal(await scalar("select count(*)::int from validate_mcp_api_key('monitor')"),0);
  await d.query(migration);
  await d.query(await sql('docs/mcp-ai-agents-rollback.sql'));
  assert.equal(await scalar("select count(*)::int from validate_api_key('writer')"),0);
  assert.equal(await scalar("select count(*)::int from validate_api_key('old')"),1);
  assert.equal(await scalar('select system_prompt from wa_ai_agents where id=$1',[agent]),'original');
  passed = true;
  console.log('PASS: legacy and scoped auth, tenant and opt-in checks, role grants, snapshot race, concurrent revision conflict, manual history, restore, conversations and rollback.');
} finally {
  await Promise.allSettled(clients.map(client=>client.end()));
  if (started) run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await unlink(passwordFile).catch(()=>{});
  if (passed) {
    const ownedDirectory = await realpath(dir);
    assert.equal(dirname(ownedDirectory), await realpath(tmpdir()));
    assert.ok(basename(ownedDirectory).startsWith('crm-agent-squad-pg-'));
    await rm(ownedDirectory, { recursive: true });
  }
}
