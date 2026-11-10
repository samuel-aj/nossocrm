import mammoth from 'mammoth';
import { createHash } from 'node:crypto';
import { isPdfTemplate, requireDynamicPrincipal, ZapSignError, ZAPSIGN_PLAN_NOTICE, type ZapSignClient, type ZapSignTemplate } from './client';
import { extractTemplateVariables } from './variables';

export async function readContractTemplate(client: ZapSignClient, template: ZapSignTemplate):
  Promise<{names:string[]; revision:string; planNotice?: string}> {
  requireDynamicPrincipal(template);
  // The list has the office's attachments; the detail also has form-only fields.
  let detail: ZapSignTemplate | undefined;
  let planNotice: string | undefined;
  try {
    detail = await client.getTemplate(template.token);
    if (detail.token !== template.token || detail.active === false) throw new Error('Modelo alterado na ZapSign.');
    if (detail.extra_templates && JSON.stringify(detail.extra_templates.map(e => e.token)) !==
        JSON.stringify((template.extra_templates ?? []).map(e => e.token))) throw new Error('A composição do modelo mudou. Consulte novamente.');
  } catch (error) {
    if (!(error instanceof ZapSignError) || error.status !== 402) throw error;
    // Allow field mapping and simulation from the catalog; never reserve a live contract.
    planNotice = ZAPSIGN_PLAN_NOTICE;
  }
  const members = [template, ...(template.extra_templates ?? [])];
  const names = new Set<string>();
  const parts: string[][] = [];
  for (const field of detail?.inputs ?? []) {
    const value = field.variable?.trim();
    if (value) for (const name of extractTemplateVariables(value.includes('{{') ? value : '{{' + value + '}}')) names.add(name);
  }
  for (const member of members) {
    if (!member.template_file || member.active === false) throw new Error('Há um documento indisponível neste modelo.');
    const { bytes } = await client.download(member.template_file, 12 * 1024 * 1024);
    parts.push([member.token, member.name, createHash('sha256').update(bytes).digest('hex')]);
    if (member !== template && isPdfTemplate(member)) continue;
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }).catch(() => {
      throw new ZapSignError(`Não foi possível abrir “${member.name}” como DOCX. Confira o formato do arquivo na ZapSign e substitua-o por um DOCX válido.`, 422);
    });
    for (const name of extractTemplateVariables(value)) names.add(name);
  }
  return { names: [...names], revision: parts.length === 1 ? parts[0][2] : createHash('sha256').update(JSON.stringify(parts)).digest('hex'),
    ...(planNotice ? {planNotice} : {}) };
}
