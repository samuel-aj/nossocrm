import { z } from 'zod';

export const destinationSchema = z.object({ conversationId: z.uuid(), connectionId: z.uuid() }).strict();
export const pageSchema = z.object({ afterId: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(30) });
export const textItemSchema = z.object({ itemId: z.uuid(), type: z.literal('text'), text: z.string().min(1).max(4096) }).strict();
export const pdfItemSchema = z.object({ itemId: z.uuid(), type: z.literal('pdf'), attachmentId: z.uuid(), caption: z.string().max(1024).optional() }).strict();
export const itemSchema = z.discriminatedUnion('type', [textItemSchema, pdfItemSchema]);
export const sequenceSchema = destinationSchema.extend({ operationId: z.uuid(), items: z.array(itemSchema).min(1).max(20) }).strict();
export type SequenceInput = z.infer<typeof sequenceSchema>;
export type SequenceItem = z.infer<typeof itemSchema>;
export const operationSchema = z.object({ operationId: z.uuid() }).strict();
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const prepareUploadSchema = destinationSchema.extend({
  fileName: z.string().min(5).max(180).regex(/^[^/\\\u0000-\u001f]+\.pdf$/i),
  mimeType: z.literal('application/pdf'), size: z.number().int().min(8).max(MAX_PDF_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function validateSequence(input: SequenceInput) {
  if (new Set(input.items.map(i => i.itemId)).size !== input.items.length) throw new Error('DUPLICATE_ITEM_ID');
  if (input.items.some(i => i.type === 'text' && !i.text.trim())) throw new Error('EMPTY_TEXT');
}
