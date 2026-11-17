// Run the deployed webhook entry points with a simulated Deno runtime and database.
// No environment file, outbound fetch, storage or WhatsApp transport is available.
import { build } from 'esbuild';
import vm from 'node:vm';
import assert from 'node:assert/strict';

for (const provider of ['meta','evolution']) {
  const slug = provider === 'meta' ? 'whatsapp-webhook-meta' : 'whatsapp-webhook';
  const compiled = await build({
    entryPoints:['supabase/functions/' + slug + '/index.ts'], bundle:true, write:false, platform:'node', format:'cjs',
    plugins:[{ name:'fake-supabase', setup(b) {
      b.onResolve({filter:/^npm:/}, () => ({path:'supabase',namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'}, () => ({ contents:'export const createClient = () => globalThis.testClient' }));
    }}],
  });
  let handle;
  let failReferral = false;
  const refs = [];
  const messages = new Map();
  const conn = {id:'connection', organization_id:'org', webhook_secret:'test', instance_token:'simulated',
    provider:'meta_cloud', meta_phone_number_id:'123', phone_number:'5511888888888'};
  const testClient = {
    from(table) {
      let matchId, inserted;
      const get = (single) => {
        if (table === 'wa_connections') return single ? conn : [];
        if (table === 'organization_settings') return {wa_groups_enabled:true};
        if (table === 'wa_conversations') return [{id:'conv',contact_id:'contact',wa_name:'Teste'}];
        if (table === 'wa_messages') {
          if (inserted) { messages.set(inserted.evolution_message_id,inserted); return null; }
          return messages.get(matchId) || null;
        }
        throw Error('Unexpected table: ' + table);
      };
      const q = {
        eq(key,value) { if (key==='evolution_message_id') matchId=value; return q; },
        in(){return q;}, neq(){return q;}, limit(){return q;}, select(){return q;}, update(){return q;},
        insert(row){inserted=row;return q;},
        maybeSingle(){return Promise.resolve({data:get(true),error:null});},
        then(ok){return ok({data:get(false),error:null});},
      };
      return q;
    },
    async rpc(name,args) {
      if (name==='record_wa_ctwa') { refs.push(args); return {error:failReferral?{message:'temporary'}:null}; }
      if (['wa_claim_heal','wa_increment_unread'].includes(name)) return {data:false,error:null};
      throw Error('Unexpected RPC: ' + name);
    },
  };
  vm.runInNewContext(compiled.outputFiles[0].text,{testClient,URL,Response,Request,Map,Date,TextEncoder,TextDecoder,
    console, fetch:()=>{throw Error('Network disallowed');},
    Deno:{env:{get:(key)=>key.startsWith('CRM_SUPABASE')?'test':undefined},serve(fn){handle=fn;}},
  });
  function payload(id,kind) {
    const group=kind==='group', echo=kind==='echo', ad=kind!=='organic';
    const contextInfo={isForwarded:kind==='forward',externalAdReply:{sourceType:'ad',sourceId:'ad-42'}};
    if(provider==='meta') {
      const msg={id,from:'5511999999999',type:'text',text:{body:'Olá'},timestamp:'1793955600',
        ...(group?{group_id:'grp'}:{}),...(echo?{to:'5511999999999'}:{}),
        ...(kind==='forward'?{context:{forwarded:true}}:{}),...(ad?{referral:{source_type:'ad',source_id:'ad-42'}}:{})};
      return {entry:[{changes:[{value:{metadata:{phone_number_id:'123'},[echo?'message_echoes':'messages']:[msg]}}]}]};
    }
    return {event:'messages.upsert',instance:'test',data:{key:{id,remoteJid:group?'123@g.us':'5511999999999@s.whatsapp.net',fromMe:echo},
      messageTimestamp:1793955600,message:{extendedTextMessage:{text:'Olá',...(ad?{contextInfo}:{})}}}};
  }
  async function post(id,kind) {
    const req=new Request('https://example.invalid/' + slug + '/test',{method:'POST',body:JSON.stringify(payload(id,kind))});
    return (await handle(req)).status;
  }
  for(const kind of ['organic','group','echo','forward']) assert.equal(await post(kind,kind),200);
  assert.equal(refs.length,0);
  failReferral=true;
  assert.equal(await post('paid','paid'),503);
  assert.ok(messages.has('paid'), 'chat message survives attribution failure');
  failReferral=false;
  assert.equal(await post('paid','paid'),200);
  assert.equal(refs.length,2);
  assert.equal(refs[1].p_conv,'conv'); assert.equal(refs[1].p_org,'org'); assert.equal(refs[1].p_connection,'connection');
  assert.equal(refs[1].p_message,'paid'); assert.equal(refs[1].p_ref.ad_id,'ad-42');
  console.log(provider + ': direct inbound, exclusions and redelivery passed.');
}
