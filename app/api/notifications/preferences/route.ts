import { requireOrgUser } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { context, saveSettings } from '@/lib/notifications/server';
import { PreferencesSchema } from '@/lib/notifications/types';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET() {
  const auth=await requireOrgUser(); if(!auth.ok) return auth.response;
  try { const {preferences,boards}=await context(auth); return reply({preferences,boards}); }
  catch { return reply({error:'Não foi possível carregar as preferências.'},500); }
}
export async function PUT(req:Request) {
  if(!isAllowedOrigin(req)) return reply({error:'Origem não permitida.'},403);
  const auth=await requireOrgUser(); if(!auth.ok) return auth.response;
  const parsed=PreferencesSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success) return reply({error:'Preferências inválidas.'},400);
  try { const {preferences,boards}=await saveSettings(auth,parsed.data); return reply({preferences,boards}); }
  catch { return reply({error:'Não foi possível salvar. Confira os boards selecionados.'},400); }
}
