import { z } from 'zod';
import { connectionAllowed, getVisibilityRules } from '@/lib/permissions/server';
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { getConnectionHistory, parseHistoryCursor } from '@/lib/whatsapp/connectionHistory';

export async function GET(request: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const id = z.uuid().safeParse(params.get('connectionId'));
  if (!id.success || params.getAll('connectionId').length !== 1) return json({ error: 'Número inválido.' }, 400);
  const connectionId = id.data;
  const rawCursor = params.get('cursor');
  const cursor = rawCursor === null ? null : parseHistoryCursor(rawCursor, connectionId);
  if (rawCursor !== null && (!cursor || params.getAll('cursor').length !== 1)) return json({ error: 'Página inválida.' }, 400);

  const { admin, user } = auth;
  try {
    const rules = await getVisibilityRules(admin, user.organizationId, user.id, user.role);
    if (!connectionAllowed(rules, connectionId)) return json({ error: 'Número não encontrado.' }, 404);
    const line = await admin.from('wa_connections').select('id')
      .eq('organization_id', user.organizationId).eq('id', connectionId).maybeSingle();
    if (line.error) throw line.error;
    if (!line.data) return json({ error: 'Número não encontrado.' }, 404);
    const response = json(await getConnectionHistory(admin, user.organizationId, connectionId, cursor));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    return json({ error: 'Não foi possível consultar o histórico desta conexão.' }, 503);
  }
}
