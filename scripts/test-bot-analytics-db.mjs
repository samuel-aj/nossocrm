// Isolated PostgreSQL only. No credentials or network; all records below are synthetic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the local PGlite module path');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const org='00000000-0000-4000-8000-000000000001', foreign='00000000-0000-4000-8000-000000000002', bot='00000000-0000-4000-8000-000000000003';
const sql = async name => db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE wa_bots(id uuid PRIMARY KEY,organization_id uuid,name text,enabled boolean,trigger jsonb,
      connection_id uuid,connection_ids uuid[],steps jsonb,start_step_id text,layout jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE wa_bot_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,bot_id uuid,
      deal_id uuid,contact_id uuid,conversation_id uuid,status text DEFAULT 'running',step_index integer DEFAULT 0,
      vars jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    GRANT SELECT,INSERT,UPDATE ON wa_bots,wa_bot_runs TO service_role;
    INSERT INTO organizations VALUES('${org}'),('${foreign}');
    INSERT INTO wa_bot_runs(organization_id,bot_id,status) VALUES('${org}','${bot}','done');`);
  const steps=[{id:'split',type:'split',mode:'round_robin',branches:[{id:'a',label:'A',weight:50,goto_step_id:'question'},{id:'b',label:'B',weight:50,goto_step_id:'question'}]},
    {id:'question',type:'send_template',buttons:['Agendar','Não quero'],button_step_ids:['goal','goal']},
    {id:'goal',type:'end'}, {id:'hook',type:'webhook',url:'https://example.invalid',secret:'SECRET_SHOULD_NOT_LEAK'}];
  await db.query(`INSERT INTO wa_bots(id,organization_id,name,enabled,trigger,connection_ids,steps,start_step_id,layout)
    VALUES($1,$2,'Synthetic bot',true,'{"type":"manual"}','{}',$3,'split',$4)`,[bot,org,JSON.stringify(steps),JSON.stringify({groups:[{id:'g',name:'Contato',step_ids:['split','question']}]})]);
  await sql('20261029143000_bot_distribution.sql');
  await sql('20261029143100_bot_analytics.sql');
  const revision=(await db.query(`SELECT wa_bot_flow_revision(to_jsonb(b)) rev FROM wa_bots b`)).rows[0].rev;
  const invoke=async(run,step,kind,output=null,target=null)=>db.query('SELECT wa_bot_record_event($1,$2,$3,$4,$5,$6)',[org,run,step,kind,output,target]);
  const create=async(dealId=null,isTest=false)=> (await db.query(`INSERT INTO wa_bot_runs(organization_id,bot_id,deal_id,is_test)
    VALUES($1,$2,COALESCE($3,gen_random_uuid()),$4) RETURNING id,deal_id`,[org,bot,dealId,isTest])).rows[0];
  const allocate=async r=>{await invoke(r.id,'split','entered');return (await db.query('SELECT wa_bot_allocate_branch($1,$2,$3) v',[org,r.id,'split'])).rows[0].v;};
  const analytics=async(goal='goal',rev=null)=> (await db.query(`SELECT wa_bot_analytics($1,$2,'2000-01-01','2100-01-01',$3,$4) v`,[org,bot,rev,goal])).rows[0].v;
  let first;
  for(let i=0;i<125;i++) {
    const run=await create(); if(i===0)first=run;
    const branch=await allocate(run); assert.equal(branch.branch_id,i%2===0?'a':'b');
    await invoke(run.id,'question','entered');
    await invoke(run.id,'question','entered'); // duplicate telemetry must not count twice
    await invoke(run.id,'question','exited',i%2===0?'button:0':'button:1','goal');
    if(i<50)await invoke(run.id,'goal','entered');
    await db.query(`UPDATE wa_bot_runs SET status='done' WHERE id=$1`,[run.id]);
  }
  const repeat=await create(first.deal_id); assert.equal((await allocate(repeat)).branch_id,'a');
  const test=await create(null,true); assert.equal((await allocate(test)).branch_id,'a');
  const original=await analytics();
  assert.equal(original.summary.runs,126); assert.equal(original.summary.uniqueSubjects,125);
  assert.equal(original.legacyRuns,1);
  assert.equal(original.groupCounts[0].n,126,'group union must not sum inner blocks');
  assert.equal(original.stepCounts.find(s=>s.step_id==='question').entered,125);
  assert.deepEqual(original.outputCounts.filter(o=>o.step_id==='question').map(o=>o.n).sort(),[62,63]);
  assert.deepEqual(original.variantCounts.map(v=>[v.subjects,v.converted]).sort(),[[62,25],[63,25]]);
  assert.equal(JSON.stringify(original).includes('SECRET_SHOULD_NOT_LEAK'),false);
  assert.equal(JSON.stringify(original).includes('https://example.invalid'),false);
  assert.equal((await analytics(null)).variantCounts.every(v=>v.converted===null),true);
  // Re-entering a wait block does not erase its first exit, but must count as waiting again.
  await invoke(first.id,'question','entered');
  await db.query(`UPDATE wa_bot_runs SET status='waiting_reply',vars='{"_waiting_step_id":"question"}' WHERE id=$1`,[first.id]);
  let waiting=await analytics();
  assert.equal(waiting.summary.waiting,1);
  assert.equal(waiting.stepCounts.find(s=>s.step_id==='question').waiting,1);
  // Scheduled waits also keep their pending block instead of the already-advanced cursor.
  await db.query(`UPDATE wa_bot_runs SET status='running',vars='{"_resume_step_id":"goal","_pending_step_exit":{"step_id":"question"}}' WHERE id=$1`,[first.id]);
  waiting=await analytics(); assert.equal(waiting.stepCounts.find(s=>s.step_id==='question').waiting,1);
  await db.query(`UPDATE wa_bot_runs SET status='done',vars='{}' WHERE id=$1`,[first.id]);
  waiting=await analytics(); assert.equal(waiting.stepCounts.find(s=>s.step_id==='question').waiting,0);
  assert.ok(waiting.botUpdatedAt);
  assert.equal((await db.query(`SELECT wa_bot_analytics($1,$2,'2000-01-01','2100-01-01') v`,[foreign,bot])).rows[0].v,null);
  await assert.rejects(()=>db.query('SELECT wa_bot_allocate_branch($1,$2,$3)',[foreign,first.id,'split']),/Run not found/);
  await assert.rejects(()=>db.exec(`SET ROLE authenticated; SELECT wa_bot_analytics('${org}','${bot}','2000-01-01','2100-01-01');`),/permission denied/);
  await db.exec('RESET ROLE');
  // A goal reached only BEFORE the split is not a conversion. Revisited AFTER it is.
  const early=await create(); await invoke(early.id,'goal','entered');
  await db.query(`UPDATE wa_bot_events SET occurred_at=now()-interval '1 hour',last_occurred_at=now()-interval '1 hour' WHERE run_id=$1`,[early.id]);
  await allocate(early);
  let count=(await analytics()).variantCounts.find(v=>v.branch_id==='b'); assert.equal(count.converted,25);
  await invoke(early.id,'goal','entered');
  count=(await analytics()).variantCounts.find(v=>v.branch_id==='b'); assert.equal(count.converted,26);
  // Editing geometry does not reset the experiment; editing a branch does.
  await db.query(`UPDATE wa_bots SET layout=jsonb_set(layout,'{groups,0,x}','1000') WHERE id=$1`,[bot]);
  assert.equal((await analytics()).isCurrentRevision,true);
  await db.query(`UPDATE wa_bots SET steps=jsonb_set(steps,'{0,branches,0,label}','"Revised A"') WHERE id=$1`,[bot]);
  const empty=await analytics(); assert.equal(empty.summary.runs,0); assert.equal(empty.isCurrentRevision,true);
  const historic=await analytics('goal',revision); assert.equal(historic.summary.runs,127); assert.equal(historic.isCurrentRevision,false);
  // Inclusive bounded cohort excludes executions outside period and real-time subsequent runs.
  const excluded=(await db.query(`SELECT wa_bot_analytics($1,$2,'2000-01-01','2000-01-02',$3,NULL) v`,[org,bot,revision])).rows[0].v;
  assert.equal(excluded.summary.runs,0);
  console.log('PASS: complete >100-run cohort, output distinction, group union, repeat identity, tests excluded, goal ordering, revisions, organization/RPC permissions, secret allowlist and date bounds.');
} catch(error) { console.error({message:error.message,where:error.where,stack:error.stack});process.exitCode=1; }
finally {await db.close();}
