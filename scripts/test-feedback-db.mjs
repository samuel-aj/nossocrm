// Usage: node scripts/test-feedback-db.mjs <local PostgreSQL bin directory>
// The test initializes its own server. It never accepts a database URL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';

const migs = [
  'supabase/migrations/20261128120000_feedback_requests.sql',
  'supabase/migrations/20261128120100_feedback_bucket.sql',
  'supabase/migrations/20261128120200_feedback_operator.sql',
];
const rollback = 'docs/feedback-requests-rollback.sql';
const load = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const hash = value => createHash('sha256').update(value).digest('hex');

async function scenarios(db, service) {
  const value = async (client, query, params = []) =>
    (await client.query({ text: query, values: params, rowMode: 'array' })).rows[0]?.[0];
  const scalar = (query, params = []) => value(db, query, params);
  await db.query(await load('supabase/tests/mcp_ai_agents.fixture.sql'));
  await db.query(await load('supabase/migrations/20261126210000_mcp_ai_agents.sql'));
  await db.query(await load('supabase/tests/aj_operator.fixture.sql'));
  await db.query(await load('supabase/migrations/20261127203007_aj_operator_keys.sql'));
  await db.query(await load('supabase/tests/feedback.fixture.sql'));

  const org = id(1), user = id(20), other = id(21);
  await db.query("insert into organizations(id,name) values($1,'Escritorio Teste')", [org]);
  await db.query("insert into profiles(id,role,first_name) values($1,'user','Ana'),($2,'user','Bia')", [user, other]);
  await db.query(
    "insert into suggestions(organization_id,author_id,content,status) values($1,$2,'pendente 1','pending'),($1,$2,'feito','done'),($1,$2,'sem status',null)",
    [org, user]);
  // Sugestão antiga sem data: a importação usa a hora da migração.
  await db.query("insert into suggestions(organization_id,author_id,content,status,created_at) values($1,$2,'sem data','pending',null)", [org, user]);
  // Um aviso que já existia: a nova regra de tipos precisa validar as linhas antigas.
  await db.query("insert into crm_notification_events(organization_id,kind,source_id) values($1,'message',$2)", [org, id(30)]);

  const apply = async () => { for (const m of migs) await db.query(await load(m)); };
  const kindCheckValidated = () => scalar("select convalidated from pg_constraint where conname='crm_notification_events_kind_check'");
  const bucket = async () => (await db.query(
    "select public, file_size_limit::int as size, allowed_mime_types as mimes from storage.buckets where id='feedback-anexos'")).rows;
  const assertBucket = async () => {
    const rows = await bucket();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].public, false);
    assert.equal(rows[0].size, 10485760);
    for (const mime of ['image/png', 'audio/webm', 'application/pdf', 'text/csv', 'application/vnd.ms-excel']) {
      assert.ok(rows[0].mimes.includes(mime), 'bucket sem ' + mime);
    }
    assert.ok(!rows[0].mimes.includes('application/x-msdownload'));
  };
  await apply();

  // Importação do mural: só pendentes (status pending ou nulo), sempre com data.
  assert.equal(await scalar("select count(*)::int from feedback_requests where origin='mural'"), 3);
  assert.equal(await scalar("select count(*)::int from feedback_requests where origin='mural' and created_at is null"), 0);
  // A regra de tipos de aviso termina validada (NOT VALID seguido de VALIDATE) e aceita 'feedback'.
  assert.equal(await kindCheckValidated(), true);
  await assert.rejects(db.query("insert into crm_notification_events(organization_id,kind,source_id) values($1,'outro',$2)", [org, id(31)]), { code: '23514' });
  // Bucket privado criado uma vez, com limite de tamanho e só os tipos aceitos pela caixa.
  await assertBucket();

  // Anônimo e autenticado não leem as tabelas.
  for (const role of ['anon', 'authenticated']) {
    await db.query('set role ' + role);
    await assert.rejects(db.query('select * from feedback_requests'), { code: '42501' });
    await db.query('reset role');
  }

  // Chaves: uma de leitura de agentes e uma da esteira.
  const readToken = 'ncrmop_' + randomBytes(24).toString('base64url');
  const feedToken = 'ncrmop_' + randomBytes(24).toString('base64url');
  await db.query("insert into aj_operator_keys(name,key_prefix,key_hash,created_by) values('Monitor',$1,$2,$3)",
    [readToken.slice(0, 12), hash(readToken), user]);
  await db.query("insert into aj_operator_keys(name,key_prefix,key_hash,created_by,scope) values('Esteira',$1,$2,$3,'feedback')",
    [feedToken.slice(0, 12), hash(feedToken), user]);
  await service.query('set role service_role');
  // O servidor apaga o pedido recém-criado quando o registro dos anexos falha.
  const orphan = await value(service, "insert into feedback_requests(organization_id,author_id,body) values($1,$2,'sem anexos') returning id", [org, user]);
  assert.equal((await service.query('delete from feedback_requests where id=$1', [orphan])).rowCount, 1);
  const auth = async token => (await service.query('select * from aj_operator_authenticate_scoped($1)', [hash(token)])).rows[0];
  const readKey = await auth(readToken), feedKey = await auth(feedToken);
  assert.equal(readKey.scope, 'ai_agents_read');
  assert.equal(feedKey.scope, 'feedback');
  const call = async (key, tool, args) =>
    (await service.query('select aj_operator_feedback($1,$2,$3::jsonb) as r', [key, tool, JSON.stringify(args)])).rows[0].r;
  const read = async (key, tool, args) =>
    (await service.query('select aj_operator_read($1,$2,$3::jsonb) as r', [key, tool, JSON.stringify(args)])).rows[0].r;

  // Cada chave só no seu escopo.
  assert.equal((await call(readKey.id, 'crm.feedback.list', {})).code, 'AUTH_INVALID');
  assert.equal((await read(feedKey.id, 'crm.ai_agents.list', {})).code, 'AUTH_INVALID');
  assert.equal((await call(feedKey.id, 'crm.feedback.delete', {})).code, 'UNKNOWN_TOOL');
  // A chave do Monitor continua lendo agentes.
  assert.deepEqual(await read(readKey.id, 'crm.ai_agents.list', {}), { agents: [], nextCursor: null });

  // Listar e ler.
  const list = await call(feedKey.id, 'crm.feedback.list', {});
  assert.equal(list.requests.length, 3);
  const reqId = list.requests[0].id;
  const got = await call(feedKey.id, 'crm.feedback.get', { requestId: reqId });
  assert.equal(got.request.author_name, 'Ana');
  assert.deepEqual(got.attachments, []);

  // Atualizar: status, resposta, mensagem e aviso no sino.
  const upd = await call(feedKey.id, 'crm.feedback.update',
    { requestId: reqId, status: 'nao_e_bug', publicReply: 'Fica em Configurações', message: 'Fica em Configurações' });
  assert.equal(upd.status, 'nao_e_bug');
  assert.equal(await scalar("select count(*)::int from crm_notification_events where kind='feedback' and source_id=$1", [reqId]), 1);
  assert.equal(await scalar("select count(*)::int from feedback_messages where request_id=$1 and author_kind='agent'", [reqId]), 1);
  // Mesmo status de novo não gera outro aviso.
  await call(feedKey.id, 'crm.feedback.update', { requestId: reqId, status: 'nao_e_bug' });
  assert.equal(await scalar("select count(*)::int from crm_notification_events where kind='feedback'"), 1);

  // Valores inválidos não passam.
  assert.equal((await call(feedKey.id, 'crm.feedback.update', { requestId: reqId, status: 'publicado' })).code, 'INVALID_ARGS');
  assert.equal((await call(feedKey.id, 'crm.feedback.update', { requestId: reqId, tutorialUrl: 'http://x' })).code, 'INVALID_ARGS');
  assert.equal((await call(feedKey.id, 'crm.feedback.get', { requestId: 'nao-e-uuid' })).code, 'INVALID_ARGS');
  assert.equal((await call(feedKey.id, 'crm.feedback.get', { requestId: id(99) })).code, 'NOT_FOUND');

  // Auditoria grava sem conteúdo.
  assert.ok(await scalar("select count(*)::int from aj_operator_audit where key_id=$1", [feedKey.id]) >= 5);

  // Revogada, a chave para.
  await db.query('update aj_operator_keys set revoked_at=now() where id=$1', [feedKey.id]);
  assert.equal((await call(feedKey.id, 'crm.feedback.list', {})).code, 'AUTH_INVALID');
  await service.query('reset role');

  // O desfazer revoga a chave da esteira ainda ativa: sem o escopo, ela leria agentes.
  const liveToken = 'ncrmop_' + randomBytes(24).toString('base64url');
  const liveKey = await value(db,
    "insert into aj_operator_keys(name,key_prefix,key_hash,created_by,scope) values('Esteira 2',$1,$2,$3,'feedback') returning id",
    [liveToken.slice(0, 12), hash(liveToken), user]);

  // Desfazer e refazer.
  await db.query(await load(rollback));
  assert.equal(await scalar("select to_regclass('public.feedback_requests') is null"), true);
  assert.equal(await scalar("select count(*)::int from information_schema.columns where table_name='aj_operator_keys' and column_name='scope'"), 0);
  assert.equal(await scalar('select revoked_at is not null from aj_operator_keys where id=$1', [liveKey]), true);
  assert.equal(await kindCheckValidated(), true);
  await assert.rejects(db.query("insert into crm_notification_events(organization_id,kind,source_id) values($1,'feedback',$2)", [org, id(32)]), { code: '23514' });
  // O bucket fica (o desfazer não apaga arquivos); a reaplicação corrige a configuração dele.
  await db.query("update storage.buckets set public=true, file_size_limit=1, allowed_mime_types=null where id='feedback-anexos'");
  await apply();
  assert.equal(await scalar("select count(*)::int from feedback_requests where origin='mural'"), 3);
  assert.equal(await kindCheckValidated(), true);
  await assertBucket();
}

if (!process.argv[2]) throw new Error('Pass the local PostgreSQL bin directory.');
const bin=resolve(process.argv[2]);
const dir=await mkdtemp(join(tmpdir(),'crm-feedback-pg-'));
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
  process.stdout.write('PASS PostgreSQL '+server.rows[0].version+' on loopback: feedback tables, mural import, bucket, key scopes, list/get/update, bell event, invalid values, audit, revocation, rollback and reapply.\n');
} finally {
  await Promise.allSettled(clients.map(c=>c.end()));
  if (started) run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  const owned=await realpath(dir);
  assert.equal(dirname(owned),await realpath(tmpdir()));
  assert.ok(basename(owned).startsWith('crm-feedback-pg-'));
  await rm(owned,{recursive:true});
}
