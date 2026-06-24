import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Total GLOBAL de sugestões — aberto a qualquer usuário autenticado.
// Retorna só o número (nunca o conteúdo), como incentivo/contador.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createStaticAdminClient();
  const { count, error } = await sb
    .from('suggestions')
    .select('id', { count: 'exact', head: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
