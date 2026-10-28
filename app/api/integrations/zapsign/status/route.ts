/**
 * GET /api/integrations/zapsign/status  (qualquer membro da organização)
 *   -> { connected, sandbox, rules: [{ stage_id, template_name }] }
 * O que as telas precisam saber sem ser admin: se a ZapSign está conectada
 * (mostra a aba Contrato no lead) e quais etapas têm contrato ao entrar (o
 * movimento do lead abre a conferência antes de enviar). Nada do token sai.
 */
import { json } from '@/lib/whatsapp/api';
import { guardRoute, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { loadZapSignSettings } from '@/lib/zapsign/signatures';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;
  try {
    const settings = await loadZapSignSettings(auth.admin, orgId);
    if (!settings) return json({ connected: false, sandbox: false, rules: [] });
    const { data, error } = await auth.admin
      .from('stage_signature_rules')
      .select('stage_id, template_name')
      .eq('organization_id', orgId)
      .eq('enabled', true);
    if (error && !/stage_signature_rules/.test(error.message)) return json({ error: error.message }, 500);
    return json({
      connected: true,
      sandbox: settings.sandbox,
      rules: ((data ?? []) as Array<{ stage_id: string; template_name: string | null }>).map((r) => ({ stage_id: r.stage_id, template_name: r.template_name })),
    });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao ler a integração') }, 500);
  }
}
