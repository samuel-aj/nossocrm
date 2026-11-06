import mammoth from 'mammoth';
import { createHash } from 'node:crypto';
import type { ZapSignClient, ZapSignTemplate } from './client';
import { extractTemplateVariables } from './variables';

export async function readContractTemplate(client: ZapSignClient, template: ZapSignTemplate) {
  if (!template.template_file) throw new Error('A ZapSign não devolveu o arquivo deste modelo.');
  const { bytes } = await client.download(template.template_file, 12 * 1024 * 1024);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return { names: extractTemplateVariables(value), revision: createHash('sha256').update(bytes).digest('hex') };
}
