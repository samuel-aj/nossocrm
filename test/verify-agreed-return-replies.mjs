// Run with an already installed @electric-sql/pglite/dist/index.js. The database lives in memory.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
const migration = '../supabase/migrations/20261127190000_keep_agreed_robot_return.sql';
const undo = '../docs/retorno-combinado-confirmacao-rollback.sql';
const loadSQL = async (path) => db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));

before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE wa_ai_agents (id uuid PRIMARY KEY, organization_id uuid, enabled boolean, tools jsonb);
    CREATE TABLE wa_bots (id uuid PRIMARY KEY, organization_id uuid, enabled boolean, connection_id uuid, connection_ids uuid[]);
    CREATE TABLE wa_conversations (
      id uuid PRIMARY KEY, organization_id uuid, ai_status text, ai_agent_id uuid, ai_approval jsonb,
      connection_id uuid, contact_id uuid, deal_id uuid, wa_phone text, ai_lock_until timestamptz);
    CREATE TABLE wa_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES wa_conversations,
      organization_id uuid, direction text, body text, media_type text, forwarded boolean DEFAULT false,
      created_at timestamptz);
    CREATE TABLE wa_bot_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, conversation_id uuid,
      bot_id uuid, contact_id uuid, deal_id uuid, phone text, status text, wake_at timestamptz,
      lock_until timestamptz, analytics_version int, is_test boolean, vars jsonb, error text, updated_at timestamptz);`);
  await loadSQL('../supabase/migrations/20261105213530_scheduled_robot_return.sql');
  await loadSQL('../supabase/migrations/20261112160000_robot_return_reply_lock.sql');
  await loadSQL(migration);
});
after(() => db.close());

async function scenario() {
  const org = randomUUID(), agent = randomUUID(), bot = randomUUID(), line = randomUUID(), chat = randomUUID();
  await db.query("INSERT INTO wa_ai_agents VALUES ($1, $2, true, jsonb_build_object('scheduled_return_bot_id', $3::text))", [agent, org, bot]);
  await db.query('INSERT INTO wa_bots VALUES ($1, $2, true, $3, NULL)', [bot, org, line]);
  await db.query(`INSERT INTO wa_conversations (id, organization_id, ai_status, ai_agent_id, connection_id, contact_id, deal_id)
    VALUES ($1, $2, 'active', $3, $4, gen_random_uuid(), gen_random_uuid())`, [chat, org, agent, line]);

  const firstTime = Date.now() - 3_600_000;
  let cursor = firstTime;
  async function inbound(body, { media = null, forwarded = false, at = cursor + 1000 } = {}) {
    await db.query("INSERT INTO wa_messages (conversation_id, organization_id, direction, body, media_type, forwarded, created_at) VALUES ($1,$2,'in',$3,$4,$5,$6)",
      [chat, org, body, media, forwarded, new Date(at)]);
    cursor = Math.max(cursor, at);
  }
  async function schedule(at, context = 'Combinado no simulador', anchor = new Date(cursor)) {
    const result = await db.query("SELECT schedule_robot_return($1,$2,$3,$4,$5,'America/Manaus',$6,$7) AS id",
      [org, chat, agent, bot, at, anchor, context]);
    return result.rows[0].id;
  }
  const begin = async (id, tenant = org) => (await db.query('SELECT begin_scheduled_robot_return($1,$2) AS ok', [tenant, id])).rows[0].ok;
  const due = id => db.query("UPDATE wa_bot_runs SET scheduled_for = now() - interval '1 second', wake_at = now() - interval '1 second' WHERE id = $1", [id]);
  const run = async id => (await db.query('SELECT * FROM wa_bot_runs WHERE id=$1', [id])).rows[0];
  await inbound('Me chama amanhã às 19h', { at: firstTime });
  const at = new Date(Date.now() + 86_400_000);
  const id = await schedule(at);
  return { id, at, chat, org, agent, bot, firstTime, cursor: () => cursor, schedule, inbound, begin, due, run };
}

test('confirmações e respostas inconclusivas mantêm o mesmo retorno até o robô iniciar', async () => {
  const s = await scenario();
  for (const reply of ['Blz', 'ok', '👍', 'combinado', 'tá bom, obrigada', 'Tenho uma dúvida', 'Se eu precisar, cancela o retorno', 'Não cancele o retorno', 'Melhor às 20h?']) {
    await s.inbound(reply);
    assert.equal((await s.run(s.id)).status, 'running', reply);
  }
  await s.inbound(null, { media: 'audio' });
  await s.inbound('Cancela o retorno', { forwarded: true });
  assert.equal(await s.begin(s.id), false, 'ainda não chegou o horário');
  assert.equal((await s.run(s.id)).scheduled_for.getTime(), s.at.getTime());
  assert.equal((await s.run(s.id)).scheduled_anchor.getTime(), s.firstTime);
  assert.equal(await s.schedule(s.at, 'Mesmo horário reafirmado depois do ok'), s.id);
  const { rows } = await db.query('SELECT count(*)::int AS total FROM wa_bot_runs WHERE conversation_id=$1', [s.chat]);
  assert.equal(rows[0].total, 1);
  await s.due(s.id);
  assert.equal(await s.begin(s.id, randomUUID()), false, 'isolamento do escritório');
  assert.equal(await s.begin(s.id), true, 'o robô consegue iniciar depois das confirmações');
  const started = await s.run(s.id);
  assert.equal(started.scheduled_anchor.getTime(), s.cursor());
  assert.equal(new Date(started.vars.__proactive_followup.anchor).getTime(), s.cursor());
  assert.equal(started.vars.__proactive_followup.scheduledReturnId, s.id);
  assert.equal(await s.begin(s.id), true, 'retry da mesma execução');
  assert.deepEqual((await s.run(s.id)).scheduled_started_at, started.scheduled_started_at);
});

test('cancelamento explícito invalida a reserva, inclusive quando a gravação chega fora de ordem', async () => {
  for (const reply of ['Não precisa mais me chamar.', 'Cancela o retorno', 'Pode desmarcar meu retorno', 'Já resolvi, não precisa mais me chamar']) {
    const s = await scenario();
    await s.inbound('Ok', { at: s.firstTime + 2000 });
    await s.inbound(reply, { at: s.firstTime + 1000 });
    assert.equal((await s.run(s.id)).status, 'cancelled', reply);
    assert.equal((await s.run(s.id)).wake_at, null);
    await s.due(s.id);
    assert.equal(await s.begin(s.id), false);
  }
});

test('uma troca confirmada substitui a reserva e protege o novo horário de decisões antigas', async () => {
  const s = await scenario();
  await s.inbound('Podemos trocar para as 20h?');
  assert.equal((await s.run(s.id)).status, 'running');
  const proposalAnchor = new Date(s.cursor());
  await s.inbound('Sim, pode marcar às 20h');
  const next = new Date(s.at.getTime() + 3_600_000);
  await assert.rejects(s.schedule(next, 'horário proposto', proposalAnchor), /respondeu/i);
  assert.equal((await s.run(s.id)).status, 'running');
  const replacement = await s.schedule(next, 'novo horário confirmado');
  assert.notEqual(replacement, s.id);
  assert.equal((await s.run(s.id)).status, 'cancelled');
  assert.equal((await s.run(s.id)).wake_at, null);
  await s.inbound('Cancela o retorno', { at: proposalAnchor.getTime() });
  await s.inbound('beleza');
  assert.equal((await s.run(replacement)).status, 'running');
  assert.equal((await s.run(replacement)).scheduled_for.getTime(), next.getTime());
  await assert.rejects(db.query('SELECT cancel_scheduled_robot_return($1,$2,$3,$4)', [s.org, s.chat, s.agent, proposalAnchor]), /respondeu/i);
  assert.equal((await s.run(replacement)).status, 'running');
  await s.due(replacement);
  assert.equal(await s.begin(replacement), true);
});

test('uma decisão de encerramento pode cancelar a reserva ativa pela RPC, somente no contexto atual', async () => {
  const s = await scenario();
  await s.inbound('Já recebi o documento. Resolvido, obrigada.');
  const cancelArgs = [s.org, s.chat, s.agent, new Date(s.cursor())];
  const query = 'SELECT cancel_scheduled_robot_return($1,$2,$3,$4) AS affected';
  await assert.rejects(db.query(query, [randomUUID(), ...cancelArgs.slice(1)]), /indisponível/i);
  assert.equal((await db.query(query, cancelArgs)).rows[0].affected, 1);
  assert.equal((await db.query(query, cancelArgs)).rows[0].affected, 0);
  await s.due(s.id);
  assert.equal(await s.begin(s.id), false);
});

test('revisão humana, pausa, encerramento e mudança de vínculo ainda protegem o disparo', async () => {
  for (const change of ["ai_status='paused'", "ai_status='stopped'", "ai_approval='{}'::jsonb", 'deal_id=gen_random_uuid()', 'connection_id=gen_random_uuid()']) {
    const s = await scenario();
    await s.inbound('blz');
    await db.query(`UPDATE wa_conversations SET ${change} WHERE id=$1`, [s.chat]);
    await s.due(s.id);
    assert.equal(await s.begin(s.id), false, change);
    assert.equal((await s.run(s.id)).status, 'cancelled', change);
  }
  const s = await scenario();
  await db.query("UPDATE wa_conversations SET ai_lock_until=now() + interval '1 minute' WHERE id=$1", [s.chat]);
  await s.due(s.id);
  assert.equal(await s.begin(s.id), false);
  assert.equal((await s.run(s.id)).status, 'running', 'resposta ainda sendo processada');
  await db.query('UPDATE wa_conversations SET ai_lock_until=NULL WHERE id=$1', [s.chat]);
  assert.equal(await s.begin(s.id), true);
});

test('reversão devolve o comportamento anterior e permite reaplicar a correção', async () => {
  const s = await scenario();
  await s.inbound('beleza');
  await loadSQL(undo);
  assert.equal((await s.run(s.id)).status, 'running');
  await s.inbound('Blz');
  assert.equal((await s.run(s.id)).status, 'cancelled');
  await loadSQL(migration);
  assert.equal((await s.run(s.id)).status, 'cancelled', 'aplicar a mudança não reativa retornos antigos');
  const restored = await scenario();
  await restored.inbound('Blz');
  assert.equal((await restored.run(restored.id)).status, 'running');
});
