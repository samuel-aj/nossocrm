/**
 * GET /api/public/v1/whatsapp/messages/{id}/media -> link temporário da mídia
 * de uma mensagem (áudio, imagem, documento, figurinha, vídeo).
 *
 * A mídia fica num bucket privado do CRM; o webhook entrega só `media_path`.
 * Aqui a integração (n8n) troca o id da mensagem por uma URL assinada (10 min)
 * para baixar/transcrever/analisar. Vídeo/áudio grandes: baixe pela URL.
 */
import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';

const EXPIRES = 600;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid message id', code: 'VALIDATION' }, { status: 400 });

  const sb = createStaticAdminClient();
  const { data: msg } = await sb
    .from('wa_messages')
    .select('id, media_url, media_type, media_mime, transcription')
    .eq('id', id)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: 'Message not found', code: 'NOT_FOUND' }, { status: 404 });
  const path = (msg.media_url as string | null) ?? '';
  if (!path) return NextResponse.json({ error: 'Message has no media', code: 'NO_MEDIA' }, { status: 404 });

  let url = path;
  if (!/^https?:\/\//i.test(path)) {
    const { data: signed, error } = await sb.storage.from('wa-media').createSignedUrl(path, EXPIRES);
    if (error || !signed?.signedUrl) {
      return NextResponse.json({ error: `Could not sign media URL: ${error?.message ?? ''}`, code: 'SIGN_FAILED' }, { status: 500 });
    }
    url = signed.signedUrl;
  }
  return NextResponse.json({
    url,
    media_type: msg.media_type ?? null,
    mime: msg.media_mime ?? null,
    transcription: msg.transcription ?? null,
    expires_in: EXPIRES,
  });
}
