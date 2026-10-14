import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { sanitizeFileName } from '@/lib/whatsapp/storageFileName';
import { checkDb, McpWhatsAppError, requireDestination, unavailable, type WhatsAppContext } from './access';
import { MAX_PDF_BYTES, prepareUploadSchema } from './schemas';

type Upload = {
  id: string; conversation_id: string; connection_id: string; file_name: string; size: number;
  sha256: string; upload_path: string; sealed_path: string; ready: boolean; expires_at: string;
};
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export function validatePdf(bytes: Uint8Array, expected: { size: number; sha256: string }) {
  if (bytes.length !== expected.size || bytes.length > MAX_PDF_BYTES || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-' || sha256(bytes) !== expected.sha256) {
    throw new McpWhatsAppError('INVALID_PDF', 'O PDF não corresponde ao tamanho, conteúdo ou SHA-256 informado.');
  }
}

/** Bounded read even if a signed upload contained more bytes than declared. */
export async function readBoundedPdf(response: Response, expected: { size: number; sha256: string }) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > expected.size) {
    await response.body?.cancel();
    throw new McpWhatsAppError('INVALID_PDF', 'Arquivo indisponível ou maior que o tamanho informado.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > expected.size || total > MAX_PDF_BYTES) throw new McpWhatsAppError('INVALID_PDF', 'PDF excede o limite informado.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = Buffer.concat(chunks);
  validatePdf(bytes, expected);
  return bytes;
}

async function readFile(ctx: WhatsAppContext, path: string, upload: Upload) {
  const { data, error } = await ctx.admin.storage.from('wa-media').createSignedUrl(path, 60);
  checkDb(error);
  if (!data) unavailable();
  return readBoundedPdf(await fetch(data.signedUrl, { signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store' }), upload);
}

async function getUpload(ctx: WhatsAppContext, id: string): Promise<Upload> {
  const { data, error } = await ctx.admin.from('mcp_wa_uploads').select('*')
    .eq('organization_id', ctx.user.organizationId).eq('api_key_id', ctx.apiKeyId).eq('actor_id', ctx.user.id).eq('id', id).maybeSingle();
  checkDb(error);
  if (!data) unavailable();
  await requireDestination(ctx, data.conversation_id, data.connection_id);
  return data as Upload;
}

export async function prepareUpload(ctx: WhatsAppContext, input: z.infer<typeof prepareUploadSchema>) {
  await requireDestination(ctx, input.conversationId, input.connectionId);
  const id = randomUUID();
  const prefix = `${ctx.user.organizationId}/out/mcp/${id}`;
  const uploadPath = `${prefix}/upload.pdf`;
  const { error } = await ctx.admin.from('mcp_wa_uploads').insert({
    id, organization_id: ctx.user.organizationId, api_key_id: ctx.apiKeyId, actor_id: ctx.user.id,
    conversation_id: input.conversationId, connection_id: input.connectionId, file_name: input.fileName,
    size: input.size, sha256: input.sha256, upload_path: uploadPath, sealed_path: `${prefix}/${randomUUID()}/${sanitizeFileName(input.fileName)}`,
  });
  checkDb(error);
  const signed = await ctx.admin.storage.from('wa-media').createSignedUploadUrl(uploadPath, { upsert: false });
  checkDb(signed.error);
  if (!signed.data) unavailable();
  return { attachmentId: id, uploadUrl: signed.data.signedUrl, method: 'PUT', contentType: 'application/pdf', expiresInSeconds: 7200, next: 'Transfira os bytes do PDF e execute crm.whatsapp.uploads.complete. Não registre a URL assinada em logs.' };
}

export async function completeUpload(ctx: WhatsAppContext, attachmentId: string) {
  const upload = await getUpload(ctx, attachmentId);
  if (!upload.ready) {
    if (Date.parse(upload.expires_at) < Date.now()) throw new McpWhatsAppError('UPLOAD_EXPIRED', 'Prepare um novo upload.');
    const bytes = await readFile(ctx, upload.upload_path, upload);
    const { error } = await ctx.admin.storage.from('wa-media').upload(upload.sealed_path, bytes, { contentType: 'application/pdf', upsert: false });
    // A concurrent finalization may have uploaded the same immutable object.
    if (error) await readFile(ctx, upload.sealed_path, upload);
    const saved = await ctx.admin.from('mcp_wa_uploads').update({ ready: true })
      .eq('organization_id', ctx.user.organizationId).eq('api_key_id', ctx.apiKeyId).eq('id', attachmentId);
    checkDb(saved.error);
  }
  return { attachmentId, ready: true, fileName: upload.file_name, mimeType: 'application/pdf', size: upload.size, sha256: upload.sha256 };
}

export async function resolveAttachment(ctx: WhatsAppContext, attachmentId: string, conversationId: string, connectionId: string) {
  const upload = await getUpload(ctx, attachmentId);
  if (!upload.ready || upload.conversation_id !== conversationId || upload.connection_id !== connectionId) unavailable();
  await readFile(ctx, upload.sealed_path, upload);
  return { path: upload.sealed_path, kind: 'document' as const, mimeType: 'application/pdf', fileName: upload.file_name };
}
