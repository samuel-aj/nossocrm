/** Shared validation for official template headers. Documents use PDF only. */
export type TemplateHeaderType = 'image' | 'video' | 'document';
export const TEMPLATE_MEDIA_BUCKET = 'wa-template-media';
export const TEMPLATE_MEDIA_RULES = {
  image: { accept: 'image/jpeg,image/png', max: 5 * 1024 * 1024, label: 'JPG ou PNG, até 5 MB' },
  video: { accept: 'video/mp4', max: 16 * 1024 * 1024, label: 'MP4 (H.264/AAC), até 16 MB' },
  document: { accept: 'application/pdf', max: 16 * 1024 * 1024, label: 'PDF, até 16 MB' },
} as const;
export function validateTemplateMedia(type: TemplateHeaderType, mime: string, size: number) {
  const rule = TEMPLATE_MEDIA_RULES[type];
  if (!rule || !rule.accept.split(',').includes(mime) || !Number.isSafeInteger(size) || size <= 0 || size > rule.max) {
    throw new Error(`Arquivo inválido. ${rule?.label ?? 'Tipo não permitido'}.`);
  }
}
export function parseTemplateHeader(comps: Record<string, unknown>[]): TemplateHeaderType | null {
  const header = comps.find(c => String(c.type).toUpperCase() === 'HEADER');
  const format = String(header?.format ?? '').toLowerCase();
  return ['image', 'video', 'document'].includes(format) ? format as TemplateHeaderType : null;
}
