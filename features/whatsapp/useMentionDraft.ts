import { useState, useCallback, type SetStateAction } from 'react';
import { reconcileMentions, type GroupMention, type GroupParticipant } from '@/lib/whatsapp/groupParticipants';

export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1].toLocaleLowerCase() };
}
export function useMentionDraft() {
  const [draft, setDraft] = useState<{ text: string; mentions: GroupMention[] }>({ text: '', mentions: [] });
  const setText = useCallback((value: SetStateAction<string>) => setDraft(old => {
    const text = typeof value === 'function' ? value(old.text) : value;
    return { text, mentions: reconcileMentions(old.text, text, old.mentions) };
  }), []);
  const selectMention = (member: GroupParticipant, range: { start: number; end: number }) => {
    const token = `@${member.name}`;
    setDraft(old => {
      const text = old.text.slice(0, range.start) + token + ' ' + old.text.slice(range.end);
      return { text, mentions: [...reconcileMentions(old.text, text, old.mentions), { id: member.id, start: range.start, end: range.start + token.length }] };
    });
    return range.start + token.length + 1;
  };
  const restoreDraft = (text: string, mentions: GroupMention[]) => setDraft(old => old.text ? old : { text, mentions });
  return { ...draft, setText, selectMention, restoreDraft };
}
