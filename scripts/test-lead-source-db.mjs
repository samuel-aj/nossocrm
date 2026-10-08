// Isolated PostgreSQL regressions. No network or production connection.
// node scripts/test-lead-source-db.mjs <temporary-path>/@electric-sql/pglite/dist/index.js
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Pass the absolute path to the temporary PGlite module.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const sql = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
try {
  await db.exec(await sql('supabase/tests/performance_lifecycle.fixture.sql'));
  await db.exec(await sql('supabase/migrations/20260909150926_performance_stage_events.sql'));
  await db.exec(await sql('supabase/migrations/20260911141654_deal_lifecycle_dates.sql'));
  await db.exec(await sql('supabase/migrations/20261008161431_performance_lifecycle_history.sql'));
  // Exercise the actual actor implementation without unrelated follow-up tables.
  const audit = await sql('supabase/migrations/20260918120000_stage_followups_and_deal_events.sql');
  const actor = audit.match(/CREATE OR REPLACE FUNCTION crm_internal\.current_actor\([\s\S]+?\n\$\$;/)?.[0];
  if (!actor) throw new Error('Actor function not found in its production migration.');
  await db.exec(actor);
  const [seed, assertions] = (await sql('supabase/tests/native_lead_source.sql')).split('-- APPLY LEAD SOURCE MIGRATION HERE');
  if (!assertions) throw new Error('Missing migration boundary in SQL tests.');
  await db.exec(seed);
  await db.exec(await sql('supabase/migrations/20261008193128_native_lead_source.sql'));
  const results = await db.exec(assertions);
  for (const result of results) for (const row of result.rows) if (row.result) console.log(row.result);
} catch (error) {
  console.error({ message: error.message, code: error.code, where: error.where, position: error.position });
  process.exitCode = 1;
} finally { await db.close(); }
