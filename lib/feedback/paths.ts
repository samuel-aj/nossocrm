export function feedbackFilePath(orgId: string, userId: string, uploadId: string, fileName: string): string {
  const lower = fileName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot > 0 ? lower.slice(dot).replace(/[^a-z0-9.]/g, '').slice(0, 10) : '';
  const base = (dot > 0 ? lower.slice(0, dot) : lower).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const safe = base ? `${base.slice(0, 80 - ext.length)}${ext}` : 'arquivo';
  return `${orgId}/${userId}/${uploadId}_${safe}`;
}

/** Só a pasta direta do usuário: sem subpastas e sem "..". */
export function ownsFeedbackPath(orgId: string, userId: string, path: string): boolean {
  const prefix = `${orgId}/${userId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/') && !rest.includes('..');
}

export function deviceFromUserAgent(ua: string | null | undefined): 'celular' | 'computador' {
  return ua && /iPhone|iPad|iPod|Android|Mobile/i.test(ua) ? 'celular' : 'computador';
}
