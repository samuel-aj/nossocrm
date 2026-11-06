import type { CreateDocFromTemplateInput, ZapSignClient, ZapSignDoc, ZapSignTemplate } from './client';
import { ZapSignError, ZAPSIGN_PLAN_NOTICE } from './client';

/** Cross-page membership is by token. Separate templates can have identical file names. */
export function officeTemplates(rows: ZapSignTemplate[]) {
  const children = new Set(rows.flatMap(row => (row.extra_templates ?? []).map(extra => extra.token)));
  return rows.filter(row => row.active !== false && !children.has(row.token))
    .sort((a, b) => Number(!!b.extra_templates?.length) - Number(!!a.extra_templates?.length));
}

export class PackageError extends Error {
  constructor(readonly docToken: string | null) {
    super('Não foi possível confirmar o pacote completo. Confira o envelope na ZapSign antes de tentar novamente. O CRM não enviou o link.');
  }
}

function fileName(name: string) {
  return name.normalize('NFC').trim().toLowerCase().replace(/\.(?:pdf|docx)$/i, '');
}

/** A standalone create never needs this step. A package uses one principal,
 * then only the missing attachments. Never repeat a POST after an ambiguous reply. */
export async function createTemplatePackage(client: ZapSignClient, tpl: ZapSignTemplate, input: CreateDocFromTemplateInput) {
  const extras = tpl.extra_templates ?? [];
  if (!extras.length) return client.createDocFromTemplate(input);
  if (extras.length > 14 || extras.some(e => !e.token || e.token === tpl.token || e.active === false) ||
      new Set(extras.map(e => e.token)).size !== extras.length) throw new PackageError(null);
  let token: string | null = null;
  try {
    const doc = await client.createDocFromTemplate({ ...input, send_automatic_email: false, send_automatic_whatsapp: false });
    token = doc.token;
    if (!token) throw new Error();
    // A create response may omit attachments. Read the principal before adding anything.
    const detail = await client.getDoc(token);
    if (detail.token !== token || !Array.isArray(detail.extra_docs)) throw new Error();
    const remaining = new Map(extras.map(e => [e.token, e]));
    const seen = new Set<string>();
    for (const attached of detail.extra_docs) {
      const model = typeof attached.template === 'string' ? attached.template : attached.template?.token;
      const matches = model ? extras.filter(e => e.token === model) : extras.filter(e => fileName(e.name) === fileName(attached.name));
      if (!attached.token || seen.has(attached.token) || matches.length !== 1 || !remaining.delete(matches[0].token)) throw new Error();
      seen.add(attached.token);
    }
    for (const extra of remaining.values()) {
      const added = await client.attachTemplate(token, extra, input.data);
      if (!added.token || seen.has(added.token)) throw new Error();
      seen.add(added.token);
    }
    const complete: ZapSignDoc = remaining.size ? await client.getDoc(token) : detail;
    const ids = new Set(complete.extra_docs?.map(e => e.token));
    if (complete.token !== token || ids.size !== extras.length || complete.extra_docs?.length !== extras.length ||
        [...seen].some(id => !ids.has(id))) throw new Error();
    return { ...doc, ...complete };
  } catch (error) {
    if (!token && error instanceof ZapSignError && error.status === 402) throw new ZapSignError(ZAPSIGN_PLAN_NOTICE, 402);
    throw new PackageError(token);
  }
}
