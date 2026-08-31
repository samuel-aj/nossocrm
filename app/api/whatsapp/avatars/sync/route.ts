/**
 * POST /api/whatsapp/avatars/sync
 *
 * Busca no provedor a foto de perfil dos contatos e dos grupos da lista de
 * conversas, baixa e guarda no bucket privado wa-media. A tela chama isso ao
 * abrir os Chats; cada chamada trata um lote pequeno, então a lista vai se
 * preenchendo aos poucos em vez de travar numa varredura.
 *
 * A URL que o provedor devolve EXPIRA em poucas horas — por isso o arquivo é
 * copiado pra cá e a coluna guarda o CAMINHO, assinado na leitura (mesmo
 * padrão de wa_messages.media_url).
 *
 * Só funciona em número por QR Code: a Cloud API da Meta não expõe a foto de
 * quem conversa com a empresa. Nesses números o provedor não implementa o
 * método e a conversa é marcada como "sincronizada sem foto", pra não ficar
 * tentando de novo a cada abertura.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getProvider } from '@/lib/whatsapp';
import { getConnectionByIdForOrg } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';

/** Conversas por chamada: o suficiente pra encher a tela sem estourar tempo. */
const LOTE = 12;
/** Foto muda de vez em quando; não vale bater no provedor toda hora. */
const VALIDADE_DIAS = 7;
const BUCKET = 'wa-media';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const orgId = auth.user.organizationId;
  const limite = new Date(Date.now() - VALIDADE_DIAS * 86_400_000).toISOString();

  // Conversas nunca sincronizadas ou com foto velha, das mais recentes pras
  // mais antigas (é o que o usuário está vendo).
  const { data: conversas, error } = await auth.admin
    .from('wa_conversations')
    .select('id, connection_id, wa_phone, group_jid, is_group, avatar_synced_at')
    .eq('organization_id', orgId)
    .or(`avatar_synced_at.is.null,avatar_synced_at.lt.${limite}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(LOTE);
  if (error) return json({ error: error.message }, 500);

  const lista = (conversas ?? []) as Array<{
    id: string;
    connection_id: string | null;
    wa_phone: string;
    group_jid: string | null;
    is_group: boolean | null;
  }>;
  if (lista.length === 0) return json({ ok: true, processadas: 0, comFoto: 0, restantes: 0 });

  // Uma conexão é usada por várias conversas: resolve cada uma só uma vez.
  const conexoes = new Map<string, Awaited<ReturnType<typeof getConnectionByIdForOrg>>>();
  const carregarConexao = async (id: string) => {
    if (!conexoes.has(id)) conexoes.set(id, await getConnectionByIdForOrg(auth.admin, orgId, id));
    return conexoes.get(id) ?? null;
  };

  let comFoto = 0;
  for (const conversa of lista) {
    // Marcado ANTES de tentar: sem foto (ou provedor sem suporte) não pode
    // virar uma tentativa nova a cada vez que a lista abre.
    const patch: { avatar_synced_at: string; avatar_path?: string } = {
      avatar_synced_at: new Date().toISOString(),
    };
    try {
      const conexao = conversa.connection_id ? await carregarConexao(conversa.connection_id) : null;
      if (conexao && conexao.status === 'connected') {
        const provider = getProvider(conexao);
        if (provider.fetchProfilePictureUrl) {
          const alvo = conversa.is_group ? conversa.group_jid || conversa.wa_phone : conversa.wa_phone;
          const url = await provider.fetchProfilePictureUrl({ to: alvo });
          if (url) {
            const img = await fetch(url, { cache: 'no-store' });
            if (img.ok) {
              const bytes = new Uint8Array(await img.arrayBuffer());
              // Limite de sanidade: foto de perfil é pequena; algo enorme aqui
              // é resposta errada do provedor, não uma foto.
              if (bytes.byteLength > 0 && bytes.byteLength <= 2_000_000) {
                const caminho = `${orgId}/avatars/${conversa.id}.jpg`;
                const { error: upError } = await auth.admin.storage
                  .from(BUCKET)
                  .upload(caminho, bytes, { contentType: 'image/jpeg', upsert: true });
                if (!upError) {
                  patch.avatar_path = caminho;
                  comFoto++;
                }
              }
            }
          }
        }
      }
    } catch {
      // Foto é enfeite: falha aqui só deixa a conversa nas iniciais.
    }
    await auth.admin
      .from('wa_conversations')
      .update(patch)
      .eq('organization_id', orgId)
      .eq('id', conversa.id);
  }

  // Quantas ainda faltam: a tela usa isso pra decidir se chama de novo.
  const { count } = await auth.admin
    .from('wa_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .or(`avatar_synced_at.is.null,avatar_synced_at.lt.${limite}`);

  return json({ ok: true, processadas: lista.length, comFoto, restantes: count ?? 0 });
}
