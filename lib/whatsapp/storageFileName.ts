/** Storage object keys need safe ASCII; the provider still receives the original display filename. */
export function sanitizeFileName(name: string): string {
  const trimmed = (name || 'arquivo').slice(-120);
  const ascii = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const safe = ascii.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+/, '');
  return safe || 'arquivo';
}
