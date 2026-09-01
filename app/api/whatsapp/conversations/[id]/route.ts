/**
 * PATCH /api/whatsapp/conversations/[id]
 *   { labelIds: string[] }
 *
 * Etiquetas da conversa. Qualquer MEMBRO da organização pode mexer (é
 * organização de atendimento: quem está no chat cuida da conversa), mas só em
 * conversa da PRÓPRIA organização — o filtro por organization_id está em
 * todas as consultas.
 *
 * NÃO existe responsável próprio da conversa: quem responde pelo chat é o dono
 * do LEAD daquele contato, calculado na leitura. Marcar de novo aqui criaria
 * duas verdades pra mesma pergunta e elas iam desencontrar.
 *
 * As etiquetas vêm por ID e são conferidas contra as da organização: id de
 * outra org (ou já apagado) é descartado, senão a conversa guardaria etiqueta
 * que não existe.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  isColunaLabelIdsAusente,
  isTabelaAusente,
  MAX_LABELS_PER_CHAT,
} from '@/lib/whatsapp/labels';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const orgId = auth.user.organizationId;

  // `null` e `[1,2]` são JSON VÁLIDOS: req.json() resolve e o catch não pega.
  // Sem esta conferência, `'labelIds' in body` estoura TypeError e a rota
  // devolve 500 em vez do 400 previsto.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'JSON inválido' }, 400);
  }
  const corpo = body as { labelIds?: unknown };

  if (!('labelIds' in corpo)) return json({ error: 'Nada para alterar' }, 400);
  if (!Array.isArray(corpo.labelIds)) return json({ error: 'Etiquetas devem ser uma lista' }, 400);

  const pedidos = Array.from(
    new Set(corpo.labelIds.filter((v): v is string => typeof v === 'string' && !!v))
  );
  // Recusa em vez de cortar em silêncio: a tela dizia "salvo" e o banco
  // guardava menos etiquetas do que a pessoa tinha marcado.
  if (pedidos.length > MAX_LABELS_PER_CHAT) {
    return json({ error: `Máximo de ${MAX_LABELS_PER_CHAT} etiquetas por conversa` }, 400);
  }

  let labelIds: string[] = [];
  if (pedidos.length > 0) {
    // Só ids que são etiquetas DESTA organização.
    const { data: validas, error: erroLabels } = await auth.admin
      .from('wa_labels')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', pedidos);
    if (erroLabels) {
      if (isTabelaAusente(erroLabels)) {
        return json({ error: 'As etiquetas ainda não foram liberadas neste ambiente. Fale com o suporte.' }, 503);
      }
      return json({ error: erroLabels.message }, 500);
    }
    const existentes = new Set((validas ?? []).map(l => l.id as string));
    labelIds = pedidos.filter(x => existentes.has(x));
  }

  const { data, error } = await auth.admin
    .from('wa_conversations')
    .update({ label_ids: labelIds })
    .eq('organization_id', orgId)
    .eq('id', id)
    .select('id, label_ids')
    .maybeSingle();

  if (error) {
    if (isColunaLabelIdsAusente(error)) {
      return json({ error: 'As etiquetas ainda não foram liberadas neste ambiente. Fale com o suporte.' }, 503);
    }
    return json({ error: error.message }, 500);
  }
  if (!data) return json({ error: 'Conversa não encontrada' }, 404);

  return json({ ok: true, conversation: data });
}
