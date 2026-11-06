/**
 * GET /api/integrations/zapsign/templates              (membro)
 *   -> { templates: [{token, name, lang, folder_path}] }   modelos da conta ZapSign
 * GET /api/integrations/zapsign/templates?token=<t>&variables=1
 *   -> { variables: ["NOME", "CPF", ...], suggestions: {NOME: "contato.nome"} }
 *   lê o DOCX do modelo e extrai as {{variáveis}}, com uma sugestão de origem
 *   para cada uma (campos fixos do CRM ou campo personalizado de mesmo nome).
 */
import { readContractTemplate } from '@/lib/zapsign/templateFile';
import { officeTemplates } from '@/lib/zapsign/templatePackage';
import { json } from '@/lib/whatsapp/api';
import { guardRoute, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { clientFor, loadZapSignSettings } from '@/lib/zapsign/signatures';
import { loadCustomFieldDefs } from '@/lib/wa-agents/leadOps';
import { autoMatchVariable } from '@/lib/zapsign/variables';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').trim();
  const wantVars = url.searchParams.get('variables') === '1';

  try {
    const settings = await loadZapSignSettings(auth.admin, orgId);
    if (!settings) return json({ error: 'A ZapSign não está conectada. Configure em Configurações > Integrações > ZapSign.', code: 'NOT_CONNECTED' }, 409);
    const client = clientFor(settings);
    const templates = officeTemplates(await client.listTemplates());

    if (!wantVars) {
      return json({
        templates: templates
          .filter((t) => t.active !== false)
          .map((t) => ({ token: t.token, name: t.name, lang: t.lang ?? null, folder_path: t.folder_path ?? null, type: t.template_type ?? null,
            attachments: (t.extra_templates ?? []).map(extra => extra.name) })),
      });
    }

    const tpl = templates.find((t) => t.token === token);
    if (!tpl) return json({ error: 'Modelo não encontrado na conta ZapSign' }, 404);
    let variables: string[];
    let planNotice: string | undefined;
    try {
      const file = await readContractTemplate(client, tpl);
      variables = file.names;
      planNotice = file.planNotice;
    } catch (err) {
      return json({ error: `Não foi possível ler todos os documentos do modelo: ${getErrorMessage(err, 'arquivo inválido')}` }, 422);
    }
    const defs = await loadCustomFieldDefs(auth.admin, orgId).catch(() => []);
    const suggestions: Record<string, string> = {};
    const fields = defs.map((f) => ({ key: f.key, label: f.label ?? f.key }));
    for (const v of variables) suggestions[v] = autoMatchVariable(v, fields);
    return json({ variables, suggestions, note: planNotice, template: { token: tpl.token, name: tpl.name } });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao consultar a ZapSign') }, 502);
  }
}
