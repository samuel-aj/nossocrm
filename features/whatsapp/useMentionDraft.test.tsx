import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mentionQuery, useMentionDraft } from './useMentionDraft';
describe('mention draft', () => {
  it('finds @ only at token boundaries and supports names with spaces', () => {
    expect(mentionQuery('mail@domain', 11)).toBeNull();
    expect(mentionQuery('Oi @Maria Si', 12)).toEqual({ start: 3, end: 12, query: 'maria si' });
  });
  it('preserves identity on selection and removes it after editing token', () => {
    const { result } = renderHook(() => useMentionDraft());
    act(() => result.current.setText('Olá @ma'));
    act(() => result.current.selectMention({ id: '1@lid', name: 'Maria', phone: null, admin: false }, { start: 4, end: 7 }));
    expect(result.current.text).toBe('Olá @Maria ');
    expect(result.current.mentions).toEqual([{ id: '1@lid', start: 4, end: 10 }]);
    act(() => result.current.setText('Olá @Mara '));
    expect(result.current.mentions).toEqual([]);
  });
  it('restores failed message tokens only if user has not written a new draft', () => {
    const { result } = renderHook(() => useMentionDraft());
    act(() => result.current.restoreDraft('@Maria', [{ id: '1@lid', start: 0, end: 6 }]));
    expect(result.current.mentions).toHaveLength(1);
    act(() => result.current.setText('outra mensagem'));
    act(() => result.current.restoreDraft('@Maria', [{ id: '1@lid', start: 0, end: 6 }]));
    expect(result.current.text).toBe('outra mensagem');
  });
});
