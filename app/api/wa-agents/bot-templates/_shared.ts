import type { SupabaseClient } from '@supabase/supabase-js';
import { UserRole } from '@/types/constants';
import { MAX_BOT_TEMPLATE_BYTES } from '@/lib/wa-agents/botTemplates';

/** Tab impersonation can change the org role, so publication checks the persisted profile. */
export async function canPublishBotTemplates(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('profiles').select('role').eq('id', userId).single();
  if (error) throw new Error(error.message);
  return data?.role === UserRole.SUPER_ADMIN;
}
export function templateScope(orgId: string, superadmin: boolean): string {
  return `organization_id.eq.${orgId},and(official.eq.true${superadmin ? '' : ',published.eq.true'})`;
}
/** Bounded stream: reject before accumulating an oversized import in memory. */
export async function readTemplateBody(req: Request): Promise<unknown> {
  const limit = MAX_BOT_TEMPLATE_BYTES + 100_000;
  if (Number(req.headers.get('content-length')) > limit) throw new Error('O arquivo excede 1 MB');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Envie um JSON');
  const decoder = new TextDecoder(); let size = 0; let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('O arquivo excede 1 MB'); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } finally { reader.releaseLock(); }
}
