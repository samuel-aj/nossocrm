import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status, headers: auth.headers });
  }

  return NextResponse.json({
    data: {
      organization_id: auth.organizationId,
      organization_name: auth.organizationName,
      api_key_prefix: auth.apiKeyPrefix,
    },
  });
}

