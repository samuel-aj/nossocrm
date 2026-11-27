import { z } from 'zod';
import { ALLOWED_MIME, ATTACHMENT_KINDS, FEEDBACK_KINDS, FEEDBACK_LIMITS } from './constants';

const mimeOf = (m: string) => m.split(';')[0].trim().toLowerCase();

export const UploadRequestSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(FEEDBACK_LIMITS.bytes),
  kind: z.enum(ATTACHMENT_KINDS),
}).refine(v => ALLOWED_MIME[v.kind].includes(mimeOf(v.mime)), { message: 'Tipo de arquivo não aceito.' });

export const AttachmentInputSchema = z.strictObject({
  path: z.string().min(3).max(400),
  kind: z.enum(ATTACHMENT_KINDS),
  mime: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(FEEDBACK_LIMITS.bytes),
}).refine(v => ALLOWED_MIME[v.kind].includes(mimeOf(v.mime)), { message: 'Tipo de arquivo não aceito.' });

export const CreateFeedbackSchema = z.strictObject({
  kind: z.enum(FEEDBACK_KINDS).nullish(),
  body: z.string().max(FEEDBACK_LIMITS.bodyChars).default(''),
  transcript: z.string().max(FEEDBACK_LIMITS.transcriptChars).nullish(),
  screenPath: z.string().max(300).nullish(),
  attachments: z.array(AttachmentInputSchema).max(FEEDBACK_LIMITS.images + FEEDBACK_LIMITS.files + FEEDBACK_LIMITS.audios).default([]),
}).superRefine((v, ctx) => {
  const count = (k: string) => v.attachments.filter(a => a.kind === k).length;
  if (count('image') > FEEDBACK_LIMITS.images) ctx.addIssue({ code: 'custom', message: `Até ${FEEDBACK_LIMITS.images} imagens por envio.` });
  if (count('file') > FEEDBACK_LIMITS.files) ctx.addIssue({ code: 'custom', message: `Até ${FEEDBACK_LIMITS.files} arquivos por envio.` });
  if (count('audio') > FEEDBACK_LIMITS.audios) ctx.addIssue({ code: 'custom', message: 'Só um áudio por envio.' });
  const hasContent = v.body.trim().length > 0 || (v.transcript ?? '').trim().length > 0 || v.attachments.length > 0;
  if (!hasContent) ctx.addIssue({ code: 'custom', message: 'Escreva, grave um áudio ou anexe um print.' });
});
export type CreateFeedbackInput = z.infer<typeof CreateFeedbackSchema>;

export const TranscribeSchema = z.strictObject({ path: z.string().min(3).max(400) });

export const ReplySchema = z.strictObject({
  body: z.string().trim().min(1).max(FEEDBACK_LIMITS.bodyChars),
});
