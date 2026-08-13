/**
 * Aviso por email de que uma conta EXISTENTE foi adicionada a mais uma
 * organização. O envio é feito pelo n8n (workflow "NossoCRM | Email - membro
 * adicionado a organização", que manda via Gmail | AJ) — o CRM só chama o
 * webhook. Falha de email NUNCA bloqueia o vínculo: retorna false e segue.
 */
const WEBHOOK_URL =
  process.env.N8N_ORG_ADDED_WEBHOOK_URL ||
  'https://n8n.anunciojuridico.com.br/webhook/nossocrm-membro-add-9f2c4e7a81d3';

export async function sendOrgAddedEmail(payload: {
  email: string;
  orgName: string;
  role: string;
  appUrl: string;
  /** Só quando a senha é CONHECIDA (Login pronto de conta nova): o email sai
   *  com email+senha. Sem ela, o email diz que a senha é a de sempre. */
  password?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
