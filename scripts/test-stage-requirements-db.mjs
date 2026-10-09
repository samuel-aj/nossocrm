// Isolated PostgreSQL regression; no network or production connection.
// node scripts/test-stage-requirements-db.mjs <path>/@electric-sql/pglite/dist/index.js
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const sql = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
let passed = 0;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function check(query, message) {
  const { rows } = await db.query(query);
  if (rows[0]?.ok !== true) throw new Error(message);
  passed++;
}
async function rejects(query, fragment) {
  try { await db.exec(query); } catch (e) { if (e.message.includes(fragment)) { passed++; return; } throw e; }
  throw new Error(`Expected rejection: ${fragment}`);
}
const move = (values = {}, changes = { isWon: true, isLost: false }, stage=103, deal=1002, source=101, board=100) =>
  `select public.complete_deal_stage_move('${id(deal)}','${id(100)}','${id(source)}','${id(board)}','${id(stage)}','${JSON.stringify(changes)}','${JSON.stringify(values)}')`;
try {
  await db.exec(await sql('supabase/tests/performance_lifecycle.fixture.sql'));
  for (const file of ['20260909150926_performance_stage_events.sql','20260911141654_deal_lifecycle_dates.sql','20261008161431_performance_lifecycle_history.sql']) {
    await db.exec(await sql(`supabase/migrations/${file}`));
  }
  const audit = await sql('supabase/migrations/20260918120000_stage_followups_and_deal_events.sql');
  await db.exec(audit.match(/CREATE OR REPLACE FUNCTION crm_internal\.current_actor\([\s\S]+?\n\$\$;/)[0]);
  const [seed] = (await sql('supabase/tests/native_lead_source.sql')).split('-- APPLY LEAD SOURCE MIGRATION HERE');
  await db.exec(seed);
  await db.exec(await sql('supabase/migrations/20261008193128_native_lead_source.sql'));
  await db.exec(`
    alter table public.deals add column inactive_at timestamptz;
    alter table public.custom_field_definitions add column id uuid default gen_random_uuid(), add column label text default 'Origem', add column type text default 'text';
    create table public.products(id uuid primary key,organization_id uuid,name text,active boolean,price numeric);
    create schema private;
    -- Stand-ins model existing permission decisions; production policies/functions are not modified.
    create function private.team_org_role(o uuid,u uuid) returns text language sql stable as $$
      select case when o=crm_test.id(1) and u=crm_test.id(11) then 'admin' when o=crm_test.id(1) and u=crm_test.id(12) then 'sales' else null end $$;
    create function private.team_is_org_member(o uuid,u uuid) returns boolean language sql stable as $$
      select o=crm_test.id(1) and u in (crm_test.id(11),crm_test.id(12)) $$;
    create function private.team_lead_allowed(o uuid,u uuid,b uuid,owner uuid,a text) returns boolean language sql stable as $$
      select o=crm_test.id(1) and u in (crm_test.id(11),crm_test.id(12)) and
        (a<>'edit' or coalesce(current_setting('crm_test.deny_edit',true),'')<>'yes') $$;
    grant select on public.board_stages,public.custom_field_definitions,public.products,public.deal_items to authenticated;
    grant insert on public.deal_items to authenticated;
    grant update on public.board_stages to authenticated;
    alter table public.board_stages enable row level security;
    create policy stages_read on public.board_stages for select to authenticated using(organization_id=crm_test.id(1));
    create policy stages_admin on public.board_stages for update to authenticated using(auth.uid()=crm_test.id(11));
    alter table public.deal_items enable row level security;
    create policy items_scope on public.deal_items to authenticated using (organization_id=crm_test.id(1)) with check (organization_id=crm_test.id(1));
    insert into public.products values (crm_test.id(50),crm_test.id(1),'Serviço',true,200), (crm_test.id(51),crm_test.id(2),'Foreign',true,300);
    insert into public.custom_field_definitions(organization_id,key,entity_type,options,id,label,type) values
      (crm_test.id(1),'signed','deal',null,crm_test.id(60),'Data da assinatura','date'),
      (crm_test.id(1),'zero','deal',null,crm_test.id(61),'Número','number'),
      (crm_test.id(2),'foreign','deal',null,crm_test.id(62),'Foreign','text');
  `);
  await db.exec(await sql('supabase/migrations/20261009214131_stage_required_fields.sql'));
  await check('select count(*)=0 as ok from crm_test.operational_updates','Migration rewrote operational deals');
  await db.exec(`update public.board_stages set required_fields=array['products','leadSource','ownerId','custom:${id(60)}','custom:${id(61)}'] where id=crm_test.id(103)`);
  await rejects(`update public.board_stages set required_fields=array['custom:${id(62)}'] where id=crm_test.id(102)`, 'Campo obrigatório indisponível');
  await rejects(`delete from public.custom_field_definitions where id=crm_test.id(60)`, 'Remova a obrigatoriedade');
  await check(`select required_fields='{}' as ok from public.board_stages where id=crm_test.id(102)`,'Other stages changed');
  await rejects(`update public.deals set stage_id=crm_test.id(103), is_won=true where id=crm_test.id(1002)`, 'Preencha os campos');
  await check(`select stage_id=crm_test.id(101) and not is_won and closed_at is null as ok from public.deals where id=crm_test.id(1002)`,'Rejected raw update changed outcome');
  await check(`select count(*)=0 as ok from crm_test.operational_updates`,'Rejected move dispatched after triggers');
  await db.exec(`set request.jwt.claim.sub='${id(11)}'; set role authenticated;`);
  await rejects(move({ product: { productId:id(50), price:200, quantity:1 }, leadSource:'Meta Ads', customFields:{ signed:'2026-02-30', zero:0 } }), 'Data da assinatura');
  await check(`select count(*)=0 as ok from public.deal_items where deal_id=crm_test.id(1002)`,'Product survived invalid custom field');
  await rejects(move({ product:{productId:id(51),price:100,quantity:1} }), 'Produto indisponível');
  await rejects(move({}, {}, 301,1002,101,300),'Etapa indisponível');
  await rejects(move({}, {},103,1003,301),'Lead indisponível');
  await rejects(move({ customFields:{foreign:'test'} }), 'Campo personalizado não exigido');
  await db.exec(`set crm_test.deny_edit='yes'`);
  await rejects(move({leadSource:'Meta Ads'}),'Sem permissão');
  await db.exec(`set crm_test.deny_edit=''`);
  const values={product:{productId:id(50),price:0,quantity:2},leadSource:'Meta Ads',customFields:{signed:'2026-09-15',zero:0}};
  await db.exec(move(values));
  await check(`select stage_id=crm_test.id(103) and is_won and closed_at is not null and lead_source='Meta Ads' and custom_fields->>'zero'='0' and value=0 as ok from public.deals where id=crm_test.id(1002)`,'Complete move not atomic or zero rejected');
  await check(`select count(*)=1 as ok from public.deal_items where deal_id=crm_test.id(1002)`,'Missing or duplicate product');
  await rejects(move(values), 'O lead mudou de etapa');
  await check(`select count(*)=1 as ok from public.deal_items where deal_id=crm_test.id(1002)`,'Retry duplicated product');
  await db.exec(`reset role; update public.deals set owner_id=crm_test.id(12) where id=crm_test.id(1001); set role authenticated; set request.jwt.claim.sub='${id(12)}'`);
  // An ordinary salesperson can fill and move, but cannot edit stage rules.
  await db.exec(move({...values,leadSource:'Indicação'},undefined,103,1001));
  await check(`select is_won and stage_id=crm_test.id(103) as ok from public.deals where id=crm_test.id(1001)`,'Salesperson cannot complete a move');
  // Invoke the configuration guard directly as seller in a separate trigger exercise.
  await db.exec(`reset role`);
  await rejects(`update public.board_stages set required_fields=array['products'] where id=crm_test.id(102)`,'Somente administradores');
  await db.exec(`reset role; set request.jwt.claim.sub=''`);
  await check(`select crm_internal.custom_stage_value_filled('number','0',null) and not crm_internal.custom_stage_value_filled('number','" "',null)
    and not crm_internal.custom_stage_value_filled('date','"2026-02-30"',null)
    and crm_internal.custom_stage_value_filled('multiselect','["A"]',array['A','B'])
    and not crm_internal.custom_stage_value_filled('select','"C"',array['A','B']) as ok`,'Typed validation incorrect');
  // Creation is unchanged, existing leads are not retroactively required to fill fields.
  await db.exec(`insert into public.deals(id,organization_id,board_id,stage_id,title,owner_id) values(crm_test.id(1004),crm_test.id(1),crm_test.id(100),crm_test.id(103),'Creation',crm_test.id(11));
    update public.deals set title='Still editable' where id=crm_test.id(1004)`);
  await check(`select title='Still editable' as ok from public.deals where id=crm_test.id(1004)`,'Unrelated edit blocked');
  await check(`select not has_function_privilege('anon','public.complete_deal_stage_move(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') as ok`,'Anonymous RPC accessible');
  console.log(`${passed} stage requirement database checks passed (isolated PostgreSQL).`);
} catch (e) {
  console.error({ message:e.message, code:e.code, where:e.where, position:e.position }); process.exitCode=1;
} finally { await db.close(); }
