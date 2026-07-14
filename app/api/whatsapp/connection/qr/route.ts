/**
 * GET /api/whatsapp/connection/qr -> QR/estado ao vivo da instância (p/ conectar o número)
 *
 * SELF-HEALING: se a instância tiver sido apagada na Evolution (ex.: alguém
 * limpando o painel /manager), recria com o MESMO nome, atualiza o token,
 * re-registra o webhook e tenta o QR de novo — o usuário nem percebe.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg, upsertConnection } from '@/lib/whatsapp/service';
import { getProvider } from '@/lib/whatsapp';
import { ensureEvolutionInstance, registerWebhook } from '@/lib/whatsapp/admin';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  let conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão não configurada' }, 400);

  try {
    let qr = await getProvider(conn).getQrCode();

    if (!qr.qrBase64 && qr.state !== 'connected') {
      // Sem QR e não conectado: a instância pode não existir mais na Evolution.
      // ensureEvolutionInstance é idempotente (recria OU recupera o token).
      const healed = await ensureEvolutionInstance(conn.instance_name);
      if (healed.token && healed.token !== conn.instance_token) {
        conn = await upsertConnection(auth.admin, auth.user.organizationId, {
          instanceName: conn.instance_name,
          token: healed.token,
          baseUrl: conn.base_url,
        });
      }
      await registerWebhook(conn);
      // pequena pausa pro Baileys da instância recém-criada inicializar
      await new Promise(resolve => setTimeout(resolve, 1500));
      qr = await getProvider(conn).getQrCode();
    }

    return json(qr);
  } catch (e) {
    return json({ error: `Falha ao obter QR: ${(e as Error).message}` }, 502);
  }
}
