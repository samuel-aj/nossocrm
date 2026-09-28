// Run with the absolute PGlite module path as argv[2]; no production connection.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [org, otherOrg, contact, otherContact, board, owner, lead, otherLead, conv, labelA, labelB] = Array.from({ length: 11 }, (_, i) => id(i + 1));
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA crm_internal;
  CREATE TABLE public.wa_labels(id uuid PRIMARY KEY, organization_id uuid, name text);
  CREATE TABLE public.deals(id uuid PRIMARY KEY, organization_id uuid, contact_id uuid, board_id uuid, owner_id uuid, deleted_at timestamptz, tags text[] DEFAULT '{}');
  CREATE TABLE public.wa_conversations(id uuid PRIMARY KEY, organization_id uuid, contact_id uuid, deal_id uuid REFERENCES public.deals(id), is_group boolean DEFAULT false, label_ids uuid[] DEFAULT '{}');
  GRANT USAGE ON SCHEMA public TO service_role,authenticated,anon;
  GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
`);
// Exercise the actual deployed label trigger bodies, not an imitation of their effects.
const tags = await readFile(new URL('../supabase/migrations/20260924010603_unified_chat_tags.sql', import.meta.url), 'utf8');
await db.exec(tags.slice(tags.indexOf('CREATE OR REPLACE FUNCTION crm_internal.fanout_deal_labels()'), tags.indexOf('DROP TRIGGER IF EXISTS unified_labels_deal_before')));
await db.exec(`
  CREATE TRIGGER labels_before BEFORE INSERT OR UPDATE OF label_ids,deal_id ON public.wa_conversations FOR EACH ROW EXECUTE FUNCTION crm_internal.validate_conversation_labels();
  CREATE TRIGGER labels_after AFTER INSERT OR UPDATE OF label_ids,deal_id ON public.wa_conversations FOR EACH ROW EXECUTE FUNCTION crm_internal.apply_conversation_labels();
  CREATE TRIGGER labels_fanout AFTER UPDATE OF tags,deleted_at ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_internal.fanout_deal_labels();
`);
const migration = await readFile(new URL('../supabase/migrations/20260928190822_resolve_conversation_deal_links.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // Safe reapplication of the additive migration.
async function reset() {
  await db.exec('RESET ROLE; TRUNCATE public.wa_conversations,public.deals,public.wa_labels;');
  await db.query('INSERT INTO public.wa_labels VALUES ($1,$2,$3),($4,$2,$5)', [labelA, org, 'Lead tag', labelB, 'Chat tag']);
  await db.query('INSERT INTO public.deals(id,organization_id,contact_id,board_id,owner_id,tags) VALUES ($1,$2,$3,$4,$5,$6)', [lead, org, contact, board, owner, ['Lead tag']]);
  await db.query('INSERT INTO public.wa_conversations(id,organization_id,contact_id,label_ids) VALUES ($1,$2,$3,$4)', [conv, org, contact, [labelB]]);
}
const call = (overrides = {}) => {
  const p = { org, conv, contact, lead, board, owner, ...overrides };
  return db.query('SELECT * FROM public.resolve_conversation_deal_link($1,$2,$3,$4,$5,$6)', [p.org, p.conv, p.contact, p.lead, p.board, p.owner]);
};
let passed = 0;
async function check(name, fn) { await reset(); await fn(); passed++; console.log(`PASS ${name}`); }
try {
  await check('unique contact lead persists and merges both label sets', async () => {
    await db.exec('SET ROLE service_role');
    assert.equal((await call()).rows[0].deal_id, lead);
    assert.equal((await call()).rows[0].deal_id, lead);
    assert.deepEqual((await db.query('SELECT tags FROM public.deals WHERE id=$1', [lead])).rows[0].tags, ['Chat tag', 'Lead tag']);
    assert.deepEqual(new Set((await db.query('SELECT label_ids FROM public.wa_conversations WHERE id=$1', [conv])).rows[0].label_ids), new Set([labelA, labelB]));
  });
  await check('multiple nondeleted leads remain unlinked', async () => {
    await db.query('INSERT INTO public.deals(id,organization_id,contact_id,board_id) VALUES ($1,$2,$3,$4)', [otherLead, org, contact, board]);
    assert.equal((await call()).rows[0].deal_id, null);
  });
  await check('deleted second lead does not prevent a unique valid link', async () => {
    await db.query('INSERT INTO public.deals(id,organization_id,contact_id,board_id,deleted_at) VALUES ($1,$2,$3,$4,now())', [otherLead, org, contact, board]);
    assert.equal((await call()).rows[0].deal_id, lead);
  });
  await check('manual unlink survives subsequent resolution', async () => {
    await db.query("UPDATE public.wa_conversations SET deal_link_mode='manual' WHERE id=$1", [conv]);
    assert.equal((await call()).rows[0].deal_id, null);
  });
  await check('existing manual link remains authoritative', async () => {
    await db.query('INSERT INTO public.deals(id,organization_id,contact_id,board_id) VALUES ($1,$2,$3,$4)', [otherLead, org, contact, board]);
    await db.query("UPDATE public.wa_conversations SET deal_id=$1,deal_link_mode='manual' WHERE id=$2", [otherLead, conv]);
    assert.equal((await call()).rows[0].deal_id, otherLead);
  });
  await check('group is never linked', async () => {
    await db.query('UPDATE public.wa_conversations SET is_group=true WHERE id=$1', [conv]);
    assert.equal((await call()).rows[0].deal_id, null);
  });
  await check('contact changed during authorization is preserved', async () => {
    await db.query('UPDATE public.wa_conversations SET contact_id=$1 WHERE id=$2', [otherContact, conv]);
    assert.equal((await call()).rows[0].deal_id, null);
  });
  await check('changed lead owner rejects stale authorization', async () => {
    await db.query('UPDATE public.deals SET owner_id=null WHERE id=$1', [lead]);
    await assert.rejects(call(), e => e.code === '40001');
  });
  await check('foreign organization cannot be linked', async () => {
    await assert.rejects(call({ org: otherOrg }), e => e.code === '40001');
  });
  await check('authenticated and anonymous callers cannot execute the service RPC', async () => {
    for (const role of ['authenticated', 'anon']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(call(), e => e.code === '42501');
      await db.exec('RESET ROLE');
    }
  });
  console.log(`All ${passed} database scenarios passed in local PostgreSQL.`);
} finally { await db.close(); }
