/**
 * GET /api/whatsapp/connection/qr -> QR/estado ao vivo da instância (p/ conectar o número)
 *
 * SELF-HEALING: se a instância tiver sido apagada na Evolution (ex.: alguém
 * limpando o painel /manager), recria com o MESMO nome, atualiza o token,
 * re-registra o webhook e tenta o QR de novo — o usuário nem percebe.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionsByOrg, upsertConnection } from '@/lib/whatsapp/service';
import { getProvider, isBusinessConnection } from '@/lib/whatsapp';
import { ensureEvolutionInstance, registerWebhook } from '@/lib/whatsapp/admin';

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  // HUB multi-número: ?id=<connectionId> pareia UMA linha QR específica (a
  // org pode ter várias). Sem id, cai na primeira linha QR (compat). Nunca
  // mira uma API oficial: não tem QR e o self-healing recriaria a instância
  // como Baileys — jamais rebaixar uma business.
  const targetId = (new URL(req.url).searchParams.get('id') || '').trim();
  const all = await getConnectionsByOrg(auth.admin, auth.user.organizationId);
  let conn = targetId
    ? all.find(c => c.id === targetId) ?? null
    : all.find(c => !isBusinessConnection(c)) ?? null;
  if (conn && isBusinessConnection(conn)) {
    return json({ error: 'Conexão via API oficial não usa QR code' }, 400);
  }
  if (!conn) {
    return json(
      { error: all.length ? 'Conexão via API oficial não usa QR code' : 'Conexão não configurada' },
      400
    );
  }

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
