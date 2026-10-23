// Isolated PostgreSQL only. Pass the local PGlite module; never reads environment credentials.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the absolute PGlite module path.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const sql = async p => (await readFile(new URL(`../${p}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
try {
  await db.exec(await sql('supabase/tests/ai_usage.fixture.sql'));
  await db.exec(await sql('supabase/migrations/20261023141552_ai_usage_controls.sql'));
  await db.exec(await sql('supabase/migrations/20261023192659_ai_usage_optional_secondary_limits.sql'));
  const results = await db.exec(await sql('supabase/tests/ai_usage.sql'));
  for (const result of results) for (const row of result.rows) if (row.result) console.log(row.result);
  const optionalResults = await db.exec(await sql('supabase/tests/ai_usage_optional_limits.sql'));
  for (const result of optionalResults) for (const row of result.rows) if (row.result) console.log(row.result);
} catch (error) {
  console.error({ message: error.message, code: error.code, where: error.where, position: error.position }); process.exitCode = 1;
} finally { await db.close(); }
