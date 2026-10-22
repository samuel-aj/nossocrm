// Isolated PostgreSQL regression runner. No network or production connection.
// npm install --prefix <temporary-directory> --ignore-scripts @electric-sql/pglite@0.3.15
// node scripts/test-performance-db.mjs <absolute-path>/@electric-sql/pglite/dist/index.js
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Pass the absolute path to the temporary PGlite module.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const sql = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
try {
  await db.exec(await sql('supabase/tests/performance_lifecycle.fixture.sql'));
  await db.exec(await sql('supabase/migrations/20260909150926_performance_stage_events.sql'));
  await db.exec(await sql('supabase/migrations/20260911141654_deal_lifecycle_dates.sql'));
  const tests = await sql('supabase/tests/performance_lifecycle.sql');
  const [seed, assertions] = tests.split('-- APPLY PERFORMANCE MIGRATION HERE');
  if (!assertions) throw new Error('Missing migration boundary in SQL tests.');
  await db.exec(seed);
  await db.exec(await sql('supabase/migrations/20261008161431_performance_lifecycle_history.sql'));
  const results = await db.exec(assertions);
  for (const result of results) for (const row of result.rows) if (row.result) console.log(row.result);
  const cumulativeTests = await sql('supabase/tests/cumulative_stage_milestones.sql');
  const [cumulativeSeed, cumulativeAssertions] = cumulativeTests.split('-- APPLY CUMULATIVE MIGRATION HERE');
  if (!cumulativeAssertions) throw new Error('Missing cumulative migration boundary in SQL tests.');
  await db.exec(cumulativeSeed);
  const cumulativeMigration = await sql('supabase/migrations/20261021223108_cumulative_stage_milestones.sql');
  await db.exec(cumulativeMigration);
  // Reapplying DDL is safe and must not create history or update existing deals.
  await db.exec(cumulativeMigration);
  for (const transaction of cumulativeAssertions.split('-- NEXT CUMULATIVE TEST TRANSACTION')) {
    const cumulativeResults = await db.exec(transaction);
    for (const result of cumulativeResults) for (const row of result.rows) if (row.result) console.log(row.result);
  }
  if (process.argv[3]) {
    const dump = {};
    for (const [key, query] of Object.entries({
      boards: 'select * from public.boards where id=crm_test.id(100)',
      stages: 'select * from public.board_stages where board_id=crm_test.id(100) and organization_id=crm_test.id(1) order by "order",id',
      deals: 'select * from public.deals where id=crm_test.id(3107)',
      stageEvents: 'select * from public.deal_stage_events where deal_id=crm_test.id(3107) order by occurred_at,id',
      lifecycleEvents: 'select * from public.deal_lifecycle_events where deal_id=crm_test.id(3107) order by occurred_at,recorded_at,id',
    })) dump[key] = (await db.query(query)).rows;
    dump.reopenedScenario = { boards: dump.boards, stages: dump.stages };
    for (const [key, query] of Object.entries({
      deals: 'select * from public.deals where id=crm_test.id(3110)',
      stageEvents: 'select * from public.deal_stage_events where deal_id=crm_test.id(3110) order by occurred_at,id',
      lifecycleEvents: 'select * from public.deal_lifecycle_events where deal_id=crm_test.id(3110) order by occurred_at,recorded_at,id',
    })) dump.reopenedScenario[key] = (await db.query(query)).rows;
    // Only synthetic fixtures from the in-memory database are exportable here.
    await writeFile(process.argv[3], JSON.stringify(dump, null, 2));
    console.log('Wrote synthetic cumulative-stage fixture.');
  }
} catch (error) {
  console.error({ message: error.message, code: error.code, where: error.where, position: error.position });
  process.exitCode = 1;
} finally {
  await db.close();
}
