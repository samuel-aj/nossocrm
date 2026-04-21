import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UserRole } from '@/types/constants';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

type Provider = 'google' | 'openai' | 'anthropic';

const UpdateOrgAISettingsSchema = z
  .object({
    aiEnabled: z.boolean().optional(),
    aiProvider: z.enum(['google', 'openai', 'anthropic']).optional(),
    aiModel: z.string().min(1).max(200).optional(),
    aiGoogleKey: z.string().optional(),
    aiOpenaiKey: z.string().optional(),
    aiAnthropicKey: z.string().optional(),
  })
  .strict();

/**
 * Handler HTTP `GET` deste endpoint (Next.js Route Handler).
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return json({ error: 'Profile not found' }, 404);
  }

  const { data: orgSettings, error: orgError } = await supabase
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', profile.organization_id)
    .maybeSingle();

  if (orgError) {
    return json({ error: orgError.message }, 500);
  }

  const aiEnabled = typeof orgSettings?.ai_enabled === 'boolean' ? orgSettings.ai_enabled : true;

  // Security: members should NOT receive raw API keys.
  if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.SUPER_ADMIN) {
    return json({
      aiEnabled,
      aiProvider: (orgSettings?.ai_provider || 'google') as Provider,
      aiModel: orgSettings?.ai_model || 'gemini-2.5-flash',
      aiGoogleKey: '',
      aiOpenaiKey: '',
      aiAnthropicKey: '',
      aiHasGoogleKey: Boolean(orgSettings?.ai_google_key),
      aiHasOpenaiKey: Boolean(orgSettings?.ai_openai_key),
      aiHasAnthropicKey: Boolean(orgSettings?.ai_anthropic_key),
    });
  }

  // Mask keys: show only last 4 chars so admin can identify which key is set
  const maskKey = (key: string | null | undefined): string => {
    if (!key) return '';
    if (key.length <= 8) return '••••' + key.slice(-2);
    return '••••••••' + key.slice(-4);
  };

  return json({
    aiEnabled,
    aiProvider: (orgSettings?.ai_provider || 'google') as Provider,
    aiModel: orgSettings?.ai_model || 'gemini-2.5-flash',
    aiGoogleKey: maskKey(orgSettings?.ai_google_key),
    aiOpenaiKey: maskKey(orgSettings?.ai_openai_key),
    aiAnthropicKey: maskKey(orgSettings?.ai_anthropic_key),
    aiHasGoogleKey: Boolean(orgSettings?.ai_google_key),
    aiHasOpenaiKey: Boolean(orgSettings?.ai_openai_key),
    aiHasAnthropicKey: Boolean(orgSettings?.ai_anthropic_key),
  });
}

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  // Mitigação CSRF: endpoint autenticado por cookies.
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return json({ error: 'Profile not found' }, 404);
  }

  if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.SUPER_ADMIN) {
    return json({ error: 'Forbidden' }, 403);
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = UpdateOrgAISettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const updates = parsed.data;

  // Normalize empty-string keys to null; ignore masked values (from GET response)
  const normalizeKey = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    // Masked keys start with "••••" — don't overwrite the real key
    if (trimmed.startsWith('••••')) return undefined;
    return trimmed;
  };

  const dbUpdates: Record<string, unknown> = {
    organization_id: profile.organization_id,
    updated_at: new Date().toISOString(),
  };

  if (updates.aiEnabled !== undefined) dbUpdates.ai_enabled = updates.aiEnabled;
  if (updates.aiProvider !== undefined) dbUpdates.ai_provider = updates.aiProvider;
  if (updates.aiModel !== undefined) dbUpdates.ai_model = updates.aiModel;

  const googleKey = normalizeKey(updates.aiGoogleKey);
  if (googleKey !== undefined) dbUpdates.ai_google_key = googleKey;

  const openaiKey = normalizeKey(updates.aiOpenaiKey);
  if (openaiKey !== undefined) dbUpdates.ai_openai_key = openaiKey;

  const anthropicKey = normalizeKey(updates.aiAnthropicKey);
  if (anthropicKey !== undefined) dbUpdates.ai_anthropic_key = anthropicKey;

  const { error: upsertError } = await supabase
    .from('organization_settings')
    .upsert(dbUpdates, { onConflict: 'organization_id' });

  if (upsertError) {
    return json({ error: upsertError.message }, 500);
  }

  return json({ ok: true });
}
