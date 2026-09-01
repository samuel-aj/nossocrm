/**
 * Etiquetas da organização (modelo do WhatsApp Business).
 *
 *   GET  -> { labels: [{ id, name, color }] }
 *   POST -> cria { name, color }
 *
 * Qualquer MEMBRO cria e usa etiqueta: é ferramenta de atendimento, e exigir
 * admin só faria o atendente parar pra pedir. O filtro por organization_id
 * está em todas as consultas.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  DEFAULT_LABEL_COLOR,
  isLabelColor,
  isTabelaAusente,
  likePattern,
  MAX_LABELS_PER_ORG,
  normalizeLabelName,
} from '@/lib/whatsapp/labels';

export const runtime = 'nodejs';

/** Banco sem a migração: recado para a pessoa, não a mensagem crua do banco. */
const ERRO_MIGRACAO = 'As etiquetas ainda não foram liberadas neste ambiente. Fale com o suporte.';

export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from('wa_labels')
    .select('id, name, color')
    .eq('organization_id', auth.user.organizationId)
    .order('name');

  // Banco ainda sem a tabela (migração pendente): devolve vazio em vez de
  // derrubar a tela dos Chats inteira.
  if (error) {
    if (isTabelaAusente(error)) {
      console.warn('[labels] tabela wa_labels ausente (migração pendente)');
      return json({ labels: [] });
    }
    return json({ error: error.message }, 500);
  }
  return json({ labels: data ?? [] });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  let body: { name?: unknown; color?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const name = normalizeLabelName(body.name);
  if (!name) return json({ error: 'Dê um nome para a etiqueta' }, 400);
  const color = isLabelColor(body.color) ? body.color : DEFAULT_LABEL_COLOR;

  const { count, error: erroCount } = await auth.admin
    .from('wa_labels')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if (erroCount) {
    if (isTabelaAusente(erroCount)) return json({ error: ERRO_MIGRACAO }, 503);
    return json({ error: erroCount.message }, 500);
  }
  if ((count ?? 0) >= MAX_LABELS_PER_ORG) {
    return json({ error: `Limite de ${MAX_LABELS_PER_ORG} etiquetas por organização` }, 400);
  }

  const { data, error } = await auth.admin
    .from('wa_labels')
    .insert({ organization_id: orgId, name, color })
    .select('id, name, color')
    .single();

  if (error) {
    if (isTabelaAusente(error)) return json({ error: ERRO_MIGRACAO }, 503);
    // Índice único por nome (sem caixa): devolve a que já existe, que é o que
    // a pessoa queria — criar duas "Cliente" não ajudaria ninguém.
    if (/duplicate|unique/i.test(error.message)) {
      const { data: existente } = await auth.admin
        .from('wa_labels')
        .select('id, name, color')
        .eq('organization_id', orgId)
        .ilike('name', likePattern(name))
        .maybeSingle();
      if (existente) return json({ label: existente, jaExistia: true });
      return json({ error: 'Já existe uma etiqueta com esse nome' }, 409);
    }
    return json({ error: error.message }, 500);
  }

  return json({ label: data });
}
