// In-memory PostgreSQL only; no credentials, production connections or message APIs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the absolute local PGlite module path.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const sql = async p => (await readFile(new URL(`../${p}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private;
    create table public.organizations(id uuid primary key,name text);
    create table public.deals(id uuid primary key,organization_id uuid references public.organizations(id),title text,board_id uuid,deleted_at timestamptz);
    alter table public.deals enable row level security;
    grant select,insert,update on public.deals to authenticated,service_role;
    create table public.wa_bots(id uuid primary key,organization_id uuid,name text,enabled boolean,trigger jsonb);
    create table public.wa_bot_runs(id uuid primary key,organization_id uuid,bot_id uuid,deal_id uuid,status text);
    create table public.crm_notification_events(id uuid primary key default gen_random_uuid(),organization_id uuid,kind text,source_id uuid,board_id uuid,
      constraint crm_notification_events_kind_check check(kind in ('message','lead')));
    grant select on public.wa_bot_runs to service_role;
    grant insert on public.crm_notification_events to service_role;
    grant usage on schema private to service_role;
  `);
  await db.exec(await sql('supabase/migrations/20260924141857_deal_recovery_alerts.sql'));
  await db.exec(await sql('supabase/tests/deal_recovery_alerts.sql'));
  await db.exec(`
    insert into public.organizations values('00000000-0000-0000-0000-000000000001','Pre-migration');
    insert into public.deals(id,organization_id,title) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Preserve old alert');
    insert into public.wa_bot_runs values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','done');
    select public.activate_deal_alert('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','preserved','Old alert');
  `);
  const before = (await db.query('select active_alert from public.deals')).rows;
  await db.exec(await sql('supabase/migrations/20261023195718_deal_alert_tones.sql'));
  assert.deepEqual((await db.query('select active_alert from public.deals')).rows, before, 'Migration rewrote old active alert');
  assert.equal((await db.query('select tone from public.deal_alert_events')).rows[0].tone, 'green');
  await db.exec(await sql('supabase/tests/deal_recovery_alerts.sql'));
  const results = await db.exec(await sql('supabase/tests/deal_alert_tones.sql'));
  for (const result of results) for (const row of result.rows) if (row.result) console.log(row.result);
  console.log('PASS: legacy regression before/after migration and pre-existing alert preservation');
} catch (error) {
  console.error({ message: error.message, code: error.code, where: error.where }); process.exitCode = 1;
} finally { await db.close(); }
