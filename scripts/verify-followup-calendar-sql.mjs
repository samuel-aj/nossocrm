// Install @electric-sql/pglite in a temporary prefix, then pass its file URL via PGLITE_MODULE.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table organizations(id uuid primary key);
create table wa_ai_agents(id uuid primary key, organization_id uuid, enabled boolean);
create table stage_followup_rules(stage_id uuid primary key, action_type text check(action_type in ('bot','message')));
create table wa_conversations(id uuid primary key, organization_id uuid, ai_agent_id uuid, ai_status text,
  last_inbound_at timestamptz, ai_state jsonb, ai_approval jsonb, ai_lock_until timestamptz, ai_status_changed_at timestamptz);
create table wa_bot_runs(id uuid primary key, organization_id uuid, conversation_id uuid, status text);
`);
await db.exec(readFileSync('supabase/migrations/20261105180000_followup_calendar.sql', 'utf8'));
const org='00000000-0000-4000-8000-000000000001', conv='00000000-0000-4000-8000-000000000002', agent='00000000-0000-4000-8000-000000000003', foreign='00000000-0000-4000-8000-000000000004';
await db.query('insert into organizations values ($1)',[org]);
await db.query('insert into wa_ai_agents values ($1,$2,true)',[agent,org]);
await db.query("insert into wa_conversations(id,organization_id,ai_agent_id,ai_status,last_inbound_at,ai_state) values($1,$2,$3,'active','2026-11-05T10:00:00Z',$4)",[conv,org,agent,JSON.stringify({dados:{name:'preservar'},followups:{cycle:'2026-11-05T10:00:00Z',done:[]}})]);
const expected=JSON.stringify({cycle:'2026-11-05T10:00:00Z',done:[]});
async function claim(orgId=org){return (await db.query('select claim_agent_followup($1,$2,$3,$4,$5,$6) as ok',[orgId,conv,agent,'2026-11-05T10:00:00Z',expected,JSON.stringify(['1h','6h'])])).rows[0].ok;}
assert.equal(await claim(foreign),false);
assert.equal(await claim(),true);
assert.equal(await claim(),false); // competing worker loses
assert.deepEqual((await db.query('select ai_state from wa_conversations')).rows[0].ai_state.dados,{name:'preservar'});
async function activate(){return (await db.query('select activate_stage_followup_agent($1,$2,$3,$4) as ok',[org,conv,agent,'2026-11-05T10:00:00Z'])).rows[0].ok;}
assert.equal(await activate(),true);
await db.exec("update wa_conversations set ai_status='paused'");
assert.equal(await activate(),false);
await db.exec("update wa_conversations set ai_status='active',last_inbound_at='2026-11-05T11:00:00Z'");
assert.equal(await activate(),false);
assert.equal(await claim(),false);
await db.exec("update wa_conversations set last_inbound_at='2026-11-05T10:00:00Z'");
await db.query("insert into wa_bot_runs values($1,$2,$3,'running')",[foreign,org,conv]);
assert.equal(await activate(),false);
assert.equal((await db.query("select has_function_privilege('authenticated','claim_agent_followup(uuid,uuid,uuid,text,jsonb,jsonb)','execute') as ok")).rows[0].ok,false);
assert.equal((await db.query("select has_function_privilege('anon','activate_stage_followup_agent(uuid,uuid,uuid,timestamptz,uuid)','execute') as ok")).rows[0].ok,false);
assert.equal((await db.query("select has_table_privilege('authenticated','followup_calendars','insert') as ok")).rows[0].ok,false);
assert.equal((await db.query("select relrowsecurity from pg_class where relname='followup_calendars'")).rows[0].relrowsecurity,true);
console.log('SQL OK: migration, organization isolation, exclusive claim, state preservation, reply/pause/robot guards, grants and RLS.');
await db.close();
