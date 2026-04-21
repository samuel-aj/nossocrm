import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { retryFailedWebhooks } from '@/lib/webhooks/outbound';

/**
 * Vercel Cron endpoint for retrying failed outbound webhooks.
 *
 * Protected by CRON_SECRET header check — only Vercel Cron (or manual
 * calls with the correct secret) can trigger this.
 *
 * Schedule: every 1 minute (configured in vercel.json)
 */
export async function GET(request: Request) {
  // Verify authorization
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Use a plain supabase-js client (no cookies/SSR needed for cron)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const result = await retryFailedWebhooks(supabase);

    return NextResponse.json({
      ok: true,
      ...result,
      // Omit individual results from response to keep it lightweight
      results: undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[webhook-retry] Error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
