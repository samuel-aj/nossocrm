import { requireOrgUser } from '@/lib/whatsapp/api';
import { feed } from '@/lib/notifications/server';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request) {
  const auth=await requireOrgUser(); if(!auth.ok) return auth.response;
  const q=new URL(req.url).searchParams;
  const since=q.get('since'),after=q.get('after'),until=q.get('until');
  if([since,until].some(v=>v!==null && !Number.isFinite(Date.parse(v))) || (after!==null && !/^\d{1,18}$/.test(after))) return reply({error:'Cursor inválido.'},400);
  try { return reply(await feed(auth,since,after,until)); }
  catch { return reply({error:'Não foi possível consultar os avisos.'},500); }
}
