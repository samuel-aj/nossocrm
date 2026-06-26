/**
 * GET /api/whatsapp/connection/qr -> QR/estado ao vivo da instância (p/ conectar o número)
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { getProvider } from '@/lib/whatsapp';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão não configurada' }, 400);

  try {
    const qr = await getProvider(conn).getQrCode();
    return json(qr);
  } catch (e) {
    return json({ error: `Falha ao obter QR: ${(e as Error).message}` }, 502);
  }
}
