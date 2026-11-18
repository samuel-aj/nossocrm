import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { describeObservation, sourceLabel, type ConnectionDiagnostics } from './connectionDiagnostics';

export type ConnectionHistoryItem = NonNullable<ConnectionDiagnostics['lastIncident']> & {
  id: string;
  resolution: 'reconnected' | 'disabled' | null;
};

export interface ConnectionHistoryPage {
  items: ConnectionHistoryItem[];
  nextCursor: string | null;
}

const pageSize = 10;
const cursorSchema = z.object({ connectionId: z.uuid(), openedAt: z.iso.datetime({ offset: true }), id: z.uuid() });
type HistoryCursor = z.infer<typeof cursorSchema>;

interface IncidentRow {
  id: string;
  opened_at: string;
  resolved_at: string | null;
  resolution: string | null;
  source: string;
  diagnostic_reason: string;
  diagnostic_source: string;
  diagnostic_at: string;
}

export function parseHistoryCursor(value: string, connectionId: string): HistoryCursor | null {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) return null;
  try {
    const result = cursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return result.success && result.data.connectionId === connectionId ? result.data : null;
  } catch {
    return null;
  }
}

export async function getConnectionHistory(
  admin: SupabaseClient, orgId: string, connectionId: string, cursor: HistoryCursor | null
): Promise<ConnectionHistoryPage> {
  const { data, error } = await admin.rpc('wa_connection_history', {
    p_org: orgId, p_connection: connectionId, p_before_at: cursor?.openedAt ?? null,
    p_before_id: cursor?.id ?? null, p_limit: pageSize + 1,
  });
  if (error) throw error;
  const rows: IncidentRow[] = data ?? [];
  const items = rows.slice(0, pageSize).map((row): ConnectionHistoryItem => ({
    id: row.id, openedAt: row.opened_at, resolvedAt: row.resolved_at,
    resolution: row.resolution === 'reconnected' || row.resolution === 'disabled' ? row.resolution : null,
    detectedBy: sourceLabel(row.source), observedAt: row.diagnostic_at,
    observedBy: sourceLabel(row.diagnostic_source), observation: describeObservation(row.diagnostic_reason, row.diagnostic_source),
  }));
  const last = items.at(-1);
  const nextCursor = last && rows.length > pageSize
    ? Buffer.from(JSON.stringify({ connectionId, openedAt: last.openedAt, id: last.id })).toString('base64url')
    : null;
  return { items, nextCursor };
}
