import document from './document.json';

export const dynamic = 'force-dynamic';

/** Standalone, synthetic layout proposals. Available only on the STAGING preview. */
export function GET() {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'staging') {
    return new Response('Not found', { status: 404 });
  }
  return new Response(document.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
