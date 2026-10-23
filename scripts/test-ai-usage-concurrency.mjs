// Real PostgreSQL, synthetic data, loopback only. No remote URLs or environment credentials.
// Usage: node scripts/test-ai-usage-concurrency.mjs <PostgreSQL bin directory> [short-name alias of this repo's tmp/ai-usage-postgres]
// The official portable runtime is supplied by the caller; this script installs no service.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.argv[2]) throw new Error('Pass the absolute local PostgreSQL bin directory.');
const bin = resolve(process.argv[2]);
const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
await Promise.all(['initdb', 'pg_ctl', 'postgres'].map(name => access(executable(name))));
const expectedRoot = fileURLToPath(new URL('../tmp/ai-usage-postgres/', import.meta.url));
await mkdir(expectedRoot, { recursive: true });
const root = process.argv[3] ? resolve(process.argv[3]) : expectedRoot;
assert.equal(await realpath(root), await realpath(expectedRoot), 'test root must remain inside the dedicated workspace folder');
const runDirectory = await mkdtemp(join(root, 'run-'));
const dataDirectory = join(runDirectory, 'data');
const passwordFile = join(runDirectory, 'password.txt');
const password = randomBytes(32).toString('hex');
await writeFile(passwordFile, password, { mode: 0o600 });
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG|DATABASE_URL|SUPABASE|OPENAI|ANTHROPIC|GOOGLE_API/i.test(key)));
const runBinary = (name, args) => execFileSync(executable(name), args, {
  env: cleanEnv, windowsHide: true, encoding: 'utf8', timeout: name === 'initdb' ? 180_000 : 60_000, maxBuffer: 2 * 1024 * 1024,
  // The detached Windows server inherits pipes; its dedicated -l file captures logs.
  stdio: name === 'pg_ctl' ? 'ignore' : 'pipe',
});
const port = await new Promise((accept, reject) => {
  const socket = createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const selected = socket.address().port;
    socket.close(error => error ? reject(error) : accept(selected));
  });
});
const connections = [];
const evidence = { runtime: null, host: '127.0.0.1', port, runDirectory, assertions: [], lockProofs: [], serverStopped: false };
let startAttempted = false;
let failure;
const check = (condition, label) => { assert.ok(condition, label); evidence.assertions.push(label); };
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sqlFile = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
const connect = async role => {
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'ai_usage_test', password, database: 'postgres',
    application_name: `ai-usage-local-test-${role}`, connectionTimeoutMillis: 5000, statement_timeout: 15_000 });
  await client.connect();
  connections.push(client);
  if (role !== 'observer') await client.query('SET ROLE service_role');
  return client;
};
const rpc = async (client, name, args) => {
  // Function names are literals in this file, never user input.
  const params = args.map((_, i) => `$${i + 1}`).join(',');
  return (await client.query(`SELECT public.${name}(${params}) AS value`, args)).rows[0].value;
};

try {
  console.log('Initializing a fresh local PostgreSQL cluster...');
  runBinary('initdb', ['-D', dataDirectory, '-U', 'ai_usage_test', '-A', 'scram-sha-256', '--pwfile', passwordFile, '--locale=C', '--encoding=UTF8', '--no-sync']);
  startAttempted = true;
  runBinary('pg_ctl', ['-D', dataDirectory, '-l', join(runDirectory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=12`, '-w', 'start']);
  const observer = await connect('observer');
  const version = await observer.query('SELECT version(), host(inet_server_addr()) AS host, current_setting($1) AS data_directory', ['data_directory']);
  evidence.runtime = version.rows[0].version;
  check(version.rows[0].host === '127.0.0.1', 'server bound to loopback');
  check(await realpath(version.rows[0].data_directory) === await realpath(dataDirectory), 'fresh isolated data directory verified');
  await observer.query(await sqlFile('supabase/tests/ai_usage.fixture.sql'));
  await observer.query(await sqlFile('supabase/migrations/20261023141552_ai_usage_controls.sql'));
  await observer.query(await sqlFile('supabase/tests/ai_usage.sql'));
  check(true, 'all 69 isolated SQL regressions passed on real PostgreSQL');
  const a = await connect('worker-a');
  const b = await connect('worker-b');
  const pidA = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const pidB = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  check(pidA !== pidB, 'workers use different real PostgreSQL backend connections');

  const scenario = async (n, { sharedContact = true, enabled = true, orgTokens = 1000 } = {}) => {
    const org = id(n), actor = id(n + 1), first = id(n + 2), second = id(n + 3), contact = id(n + 4);
    await observer.query('INSERT INTO public.organizations VALUES($1);', [org]);
    await observer.query('INSERT INTO public.profiles VALUES($1,$2)', [actor, org]);
    await observer.query('INSERT INTO public.contacts VALUES($1,$2,NULL)', [contact, org]);
    await observer.query('INSERT INTO public.wa_conversations(id,organization_id,contact_id,wa_phone) VALUES($1,$3,$4,$5),($2,$3,$6,$7)',
      [first, second, org, contact, `test-${n}-a`, sharedContact ? contact : null, `test-${n}-b`]);
    await rpc(a, 'ai_usage_policy_set', [org, { enabled, conversation_tokens: 100, organization_daily_tokens: orgTokens }]);
    const firstAccount = await rpc(a, 'ai_usage_context', [org, first]);
    const secondAccount = await rpc(a, 'ai_usage_context', [org, second]);
    const input = (conversation, account, key, amount = 60, enforcementChecked = true) => ({
      organization_id: org, conversation_id: conversation, account_id: account, scope: 'conversation',
      idempotency_key: key, operation: 'concurrency_fixture', provider: 'fixture', model: 'no-model-call',
      unit: 'tokens', reserved_amount: amount, metadata: { enforcementChecked },
    });
    return { org, actor, first, second, firstAccount, secondAccount,
      reserveA: (key, amount, checked) => input(first, firstAccount, key, amount, checked),
      reserveB: (key, amount, checked) => input(second, secondAccount, key, amount, checked) };
  };

  const contested = async (label, first, second) => {
    await a.query('BEGIN');
    let waiting;
    try {
      const firstResult = await first();
      // Attach rejection immediately while observing the other connection's lock wait.
      waiting = second().then(value => ({ value }), error => ({ error }));
      const deadline = Date.now() + 5000;
      let lock;
      while (Date.now() < deadline) {
        const result = await observer.query('SELECT wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1', [pidB]);
        lock = result.rows[0];
        if (lock?.wait_event_type === 'Lock' && lock.blockers.includes(pidA)) break;
        await new Promise(done => setTimeout(done, 20));
      }
      check(lock?.wait_event_type === 'Lock' && lock.blockers.includes(pidA), `${label}: second connection demonstrably waits for first`);
      evidence.lockProofs.push({ scenario: label, firstPid: pidA, secondPid: pidB, ...lock });
      await a.query('COMMIT');
      const result = await waiting;
      if (result.error) throw result.error;
      return [firstResult, result.value];
    } catch (error) {
      await a.query('ROLLBACK').catch(() => {});
      if (waiting) await waiting;
      throw error;
    }
  };

  const shared = await scenario(1000);
  const [r1, r2] = await contested('same-contact reservation',
    () => rpc(a, 'ai_usage_reserve', [shared.reserveA('reserve-a')]),
    () => rpc(b, 'ai_usage_reserve', [shared.reserveB('reserve-b')]));
  check(r1.allowed && !r2.allowed && r2.reason === 'conversation_token_limit', 'parallel reservations cannot exceed shared conversation quota');
  const sharedBudget = await rpc(a, 'ai_usage_budget', [shared.org, shared.first]);
  check(Number(sharedBudget.tokens_reserved) === 60, 'only one 60-token reservation is held against a 100-token quota');

  const organization = await scenario(2000, { sharedContact: false, orgTokens: 100 });
  const [o1, o2] = await contested('organization reservation',
    () => rpc(a, 'ai_usage_reserve', [organization.reserveA('org-a')]),
    () => rpc(b, 'ai_usage_reserve', [organization.reserveB('org-b')]));
  check(o1.allowed && !o2.allowed && o2.reason === 'organization_daily_token_limit', 'different contacts cannot jointly exceed organization quota');

  const dispatch = await scenario(3000);
  const reserved = await rpc(a, 'ai_usage_reserve', [dispatch.reserveA('dispatch-once', 20)]);
  const [d1, d2] = await contested('dispatch once',
    () => rpc(a, 'ai_usage_dispatch', [dispatch.org, reserved.attempt_id]),
    () => rpc(b, 'ai_usage_dispatch', [dispatch.org, reserved.attempt_id]));
  check(d1 === true && d2 === false, 'exactly one concurrent worker receives dispatch authorization');
  await rpc(a, 'ai_usage_settle', [dispatch.org, reserved.attempt_id, { status: 'completed', actualAmount: 20, totalTokens: 20 }]);
  await rpc(a, 'ai_usage_block', [dispatch.org, dispatch.firstAccount, dispatch.first, 'fixture-block']);
  const grant = { organization_id: dispatch.org, conversation_id: dispatch.first, actor_id: dispatch.actor,
    reason: 'Synthetic concurrency review', tokens: 50, idempotency_key: 'same-manual-grant' };
  const [g1, g2] = await contested('grant idempotency',
    () => rpc(a, 'ai_usage_grant', [grant]), () => rpc(b, 'ai_usage_grant', [grant]));
  check(g1 === true && g2 === false, 'concurrent replay grants additional quota exactly once');
  const granted = await rpc(a, 'ai_usage_budget', [dispatch.org, dispatch.first]);
  check(Number(granted.tokens_granted) === 50 && Number(granted.tokens_used) === 20, 'manual grant preserves usage and adds only one credit');
  const state = await observer.query('SELECT ai_status FROM public.wa_conversations WHERE id=$1', [dispatch.first]);
  check(state.rows[0].ai_status === 'paused', 'manual quota release never resumes or sends automatically');

  const reservePolicy = await scenario(4000, { enabled: false });
  const [, pr] = await contested('enable before reserve',
    () => rpc(a, 'ai_usage_policy_set', [reservePolicy.org, { enabled: true }]),
    () => rpc(b, 'ai_usage_reserve', [reservePolicy.reserveB('stale-unprotected-reserve', 20, false)]));
  check(!pr.allowed && pr.reason === 'enforcement_not_checked', 'stale measurement-only context cannot reserve after concurrent activation');

  const dispatchPolicy = await scenario(5000, { enabled: false });
  const beforeEnable = await rpc(a, 'ai_usage_reserve', [dispatchPolicy.reserveA('before-enable', 20, false)]);
  const [, pd] = await contested('enable before dispatch',
    () => rpc(a, 'ai_usage_policy_set', [dispatchPolicy.org, { enabled: true }]),
    () => rpc(b, 'ai_usage_dispatch', [dispatchPolicy.org, beforeEnable.attempt_id]));
  check(pd === false, 'concurrent activation prevents dispatch of an unchecked reservation');

  const disablePolicy = await scenario(6000);
  const [, blocked] = await contested('disable before block',
    () => rpc(a, 'ai_usage_policy_set', [disablePolicy.org, { enabled: false }]),
    () => rpc(b, 'ai_usage_block', [disablePolicy.org, disablePolicy.secondAccount, disablePolicy.second, 'usage_unknown']));
  check(blocked === false && (await rpc(a, 'ai_usage_budget', [disablePolicy.org, disablePolicy.second])).blocked_at === null,
    'concurrent disabling prevents a new durable block from a stale enabled context');

  console.log(`PASS: ${evidence.assertions.length} real PostgreSQL checks, ${evidence.lockProofs.length} demonstrated concurrent lock waits, plus 69 SQL regressions.`);
} catch (error) {
  failure = error;
  evidence.error = { message: error.message, code: error.code, stdout: error.stdout?.slice(-2000), stderr: error.stderr?.slice(-2000) };
  process.exitCode = 1;
} finally {
  await Promise.all(connections.map(client => client.end().catch(() => {})));
  if (startAttempted) {
    try { runBinary('pg_ctl', ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']); evidence.serverStopped = true; }
    catch (error) { evidence.stopError = error.message; process.exitCode = 1; }
  }
  await unlink(passwordFile).catch(() => {});
  await writeFile(join(runDirectory, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${join(runDirectory, 'result.json')}`);
  console.log(`Owned test server stopped: ${evidence.serverStopped}`);
  if (failure) console.error({ message: failure.message, code: failure.code });
}
