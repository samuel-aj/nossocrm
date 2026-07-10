import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel Cron: devolve ao funil os leads guardados em "Inativos" há 30+ dias.
 *
 * Para cada lead vencido: limpa deals.inactive_at (o lead reaparece na coluna
 * onde estava) e cria uma notificação em system_notifications avisando a
 * devolução — assim o cliente entende que aquele lead estava guardado.
 *
 * Protegido por CRON_SECRET (mesmo padrão do webhook-retry).
 * Agenda: diária (vercel.json).
 */

const INACTIVE_RETURN_DAYS = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const cutoff = new Date(Date.now() - INACTIVE_RETURN_DAYS * 86_400_000).toISOString();

  try {
    const { data: dueDeals, error: findErr } = await supabase
      .from('deals')
      .select('id, title, organization_id, contact_id')
      .not('inactive_at', 'is', null)
      .lte('inactive_at', cutoff)
      .is('deleted_at', null)
      .limit(500);

    if (findErr) {
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }
    if (!dueDeals || dueDeals.length === 0) {
      return NextResponse.json({ ok: true, returned: 0 });
    }

    // Devolve todos de uma vez (o lead volta pra coluna onde estava).
    const ids = dueDeals.map(d => d.id);
    const { error: updErr } = await supabase
      .from('deals')
      .update({ inactive_at: null, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Reativa os contatos INATIVOS dos leads devolvidos — senão o carimbo
    // automático do board guarda o lead de volta em Inativos na hora.
    const contactIds = Array.from(
      new Set(dueDeals.map(d => d.contact_id).filter((id): id is string => !!id))
    );
    let contactsError: string | null = null;
    if (contactIds.length > 0) {
      const { error: contactErr } = await supabase
        .from('contacts')
        .update({ status: 'ACTIVE' })
        .in('id', contactIds)
        .eq('status', 'INACTIVE');
      if (contactErr) contactsError = contactErr.message;
    }

    // Notificação por lead devolvido (org-scoped; aparece no sino do CRM).
    const { error: notifErr } = await supabase.from('system_notifications').insert(
      dueDeals.map(d => ({
        organization_id: d.organization_id,
        type: 'SYSTEM_INFO',
        title: 'Lead devolvido dos Inativos',
        message: `O negócio "${d.title}" completou ${INACTIVE_RETURN_DAYS} dias em Inativos e foi devolvido ao funil.`,
        link: '/boards',
        severity: 'medium',
      }))
    );

    return NextResponse.json({
      ok: true,
      returned: ids.length,
      contacts_reactivated: contactsError ? `falhou: ${contactsError}` : contactIds.length,
      notifications: notifErr ? `falhou: ${notifErr.message}` : ids.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
