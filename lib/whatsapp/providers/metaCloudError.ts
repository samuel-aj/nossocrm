/** Graph error messages and error_data can include user-provided content. Preserve only codes. */
export function metaErrorReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return;
  const { code, error_subcode: subcode } = value as Record<string, unknown>;
  const validCode = (n: unknown) => (typeof n === 'string' || typeof n === 'number') && /^\d{1,8}$/.test(String(n));
  if (!validCode(code)) return;
  return validCode(subcode) ? `meta_code_${code}_sub_${subcode}` : `meta_code_${code}`;
}
