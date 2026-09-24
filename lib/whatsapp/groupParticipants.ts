/** Portable member identity: LIDs identify users but are never telephone numbers. */
export interface GroupParticipant {
  id: string;
  name: string;
  phone: string | null;
  admin: boolean;
}
export interface GroupMention { id: string; start: number; end: number }
const MEMBER_JID = /^[0-9]+(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/;

function phoneFrom(value: unknown): string | null {
  if (typeof value !== 'string' || value.endsWith('@lid')) return null;
  const raw = value.replace(/@s\.whatsapp\.net$/, '').replace(/:\d+$/, '');
  return /^\+?[1-9]\d{6,14}$/.test(raw) ? `+${raw.replace(/^\+/, '')}` : null;
}

export function normalizeGroupParticipants(raw: unknown): GroupParticipant[] {
  const values = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && 'participants' in raw ? raw.participants : null);
  if (!Array.isArray(values)) throw new Error('O provedor não retornou a lista de participantes.');
  const result = new Map<string, GroupParticipant>();
  for (const item of values) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !MEMBER_JID.test(item.id)) continue;
    const phone = phoneFrom(item.phoneNumber) ?? phoneFrom(item.phone) ?? phoneFrom(item.id);
    const name = [item.name, item.pushName, item.notify].find(v => typeof v === 'string' && v.trim()) as string | undefined;
    result.set(item.id, { id: item.id, name: name?.trim().slice(0, 120) || phone || 'Participante sem nome', phone, admin: item.admin === 'admin' || item.admin === 'superadmin' });
  }
  return [...result.values()];
}

/** Drop edited tokens; shift intact tokens after the edited range. */
export function reconcileMentions(before: string, after: string, mentions: GroupMention[]): GroupMention[] {
  if (before === after) return mentions;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return mentions.flatMap(m => m.end <= start ? [m] : m.start >= oldEnd ? [{ ...m, start: m.start + delta, end: m.end + delta }] : []);
}

/** Translate only validated, selected spans to WhatsApp tokens, preserving CRM display text. */
export function resolveGroupMentions(text: string, mentions: GroupMention[], members: GroupParticipant[]): { text: string; mentioned: string[] } {
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  const ids = new Set(members.map(m => m.id));
  let cursor = 0, wire = '';
  for (const m of sorted) {
    if (!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start < cursor || m.end <= m.start || m.end > text.length || text[m.start] !== '@' || !ids.has(m.id)) {
      throw new Error('Uma menção não está mais disponível. Selecione o participante novamente.');
    }
    wire += text.slice(cursor, m.start) + `@${m.id.split('@')[0].split(':')[0]}`;
    cursor = m.end;
  }
  return { text: wire + text.slice(cursor), mentioned: [...new Set(sorted.map(m => m.id))] };
}
