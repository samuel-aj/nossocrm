// Isolated PostgreSQL. Pass the installed @electric-sql/pglite/dist/index.js path. No network.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let passed = 0;
const check = async (sql, expected) => { const { rows } = await db.query(sql); assert.deepEqual(rows[0].value, expected); passed++; };
const reject = async (sql, fragment) => { await assert.rejects(db.exec(sql), e => e.message.includes(fragment)); passed++; };
const items = JSON.stringify([{ itemId: id(11), type: 'text', text: 'Olá!\n\n*Revisão* → 😊' }, { itemId: id(12), type: 'pdf', attachmentId: id(30) }]);
const create = (org=1,key=2,op=3,hash='a'.repeat(64),payload=items) => `select public.mcp_wa_create_operation('${id(org)}','${id(key)}','${id(op)}','${id(4)}','${id(5)}','${id(6)}','${hash}','${payload.replaceAll("'", "''")}')`;
const claim = (token=50,org=1,key=2,op=3) => `select public.mcp_wa_claim_item('${id(org)}','${id(key)}','${id(op)}','${id(token)}') as value`;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.organizations(id uuid primary key); insert into public.organizations values('${id(1)}'),('${id(9)}');
    grant usage on schema public to anon,authenticated,service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261014155433_mcp_whatsapp_operations.sql', import.meta.url), 'utf8'));
  for (const role of ['anon', 'authenticated']) {
    await check(`select has_table_privilege('${role}','public.mcp_wa_items','SELECT') as value`, false);
    await check(`select has_table_privilege('${role}','public.mcp_wa_uploads','INSERT') as value`, false);
    await check(`select has_function_privilege('${role}','public.mcp_wa_claim_item(uuid,uuid,uuid,uuid)','EXECUTE') as value`, false);
    await check(`select has_function_privilege('${role}','public.mcp_wa_create_operation(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') as value`, false);
  }
  await check(`select bool_and(relrowsecurity) as value from pg_class where relname in ('mcp_wa_items','mcp_wa_uploads','mcp_wa_operations')`, true);
  await db.exec('set role service_role');
  await db.exec(create()); await db.exec(create());
  await check('select count(*)::int as value from public.mcp_wa_items', 2);
  await check('select count(*)::int as value from public.mcp_wa_operations', 1);
  await check(`select payload->>'text' as value from public.mcp_wa_items where item_id='${id(11)}'`, 'Olá!\n\n*Revisão* → 😊');
  await reject(create(1,2,3,'b'.repeat(64)), 'IDEMPOTENCY_CONFLICT');
  await reject(create(1,2,7,'c'.repeat(64),JSON.stringify([{itemId:id(11)},{itemId:id(11)}])), 'duplicate');
  await check(`select count(*)::int as value from public.mcp_wa_operations where operation_id='${id(7)}'`, 0);
  const first = (await db.query(claim())).rows[0].value;
  assert.equal(first.item_id,id(11)); passed++;
  await check(claim(51), null);
  await db.exec(`update public.mcp_wa_items set lease_until=now()-interval '1 second' where item_id='${id(11)}'`);
  const recovered = (await db.query(claim(52))).rows[0].value;
  assert.equal(recovered.claim_token,id(52)); passed++;
  await check(`with changed as (update public.mcp_wa_items set state='dispatching' where item_id='${id(11)}' and claim_token='${id(50)}' and state='preparing' returning *) select count(*)::int as value from changed`, 0);
  await db.exec(`update public.mcp_wa_items set state='dispatching',updated_at=now()-interval '1 day',lease_until=now()-interval '1 day' where item_id='${id(11)}'`);
  await check(claim(53), null);
  await db.exec(`update public.mcp_wa_items set state='uncertain' where item_id='${id(11)}'`);
  await check(claim(53), null);
  await db.exec(`update public.mcp_wa_items set state='accepted' where item_id='${id(11)}'`);
  await check(claim(53), null);
  await db.exec(`update public.mcp_wa_items set state='completed' where item_id='${id(11)}'`);
  assert.equal((await db.query(claim(53))).rows[0].value.item_id,id(12)); passed++;
  await check(claim(54),null);
  await db.exec(`update public.mcp_wa_items set state='completed'`);
  await check(claim(54),null);
  await check(claim(54,9),null);
  await check(claim(54,1,99),null);
  await db.exec(create(9));
  assert.equal((await db.query(claim(55,9))).rows[0].value.state,'preparing'); passed++;
  await check(`select count(*)::int as value from public.mcp_wa_items where organization_id='${id(1)}' and state='completed'`,2);
  console.log(`${passed} MCP journal database checks passed (isolated PostgreSQL).`);
} finally { await db.close(); }
