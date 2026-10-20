import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useConversationSender, type SenderPermit } from './useConversationSender';
import type { WaChatData, WaChatMessage, WaSender } from './useWhatsAppChat';

const one: WaSender = { id: 'one', phoneNumber: '+5511111111111', profileName: 'Número 1', provider: 'evolution' };
const two: WaSender = { id: 'two', phoneNumber: '+5522222222222', profileName: 'Número 2', provider: 'meta_cloud' };
const third: WaSender = { id: 'third', phoneNumber: '+5533333333333', profileName: 'Número 3', provider: 'evolution' };
function message(connectionId: string | null, date: string, patch: Partial<WaChatMessage> = {}): WaChatMessage {
  return {
    id: `message-${connectionId}-${date}`, connection_id: connectionId, direction: 'out', status: 'sent',
    body: 'Olá', media_type: null, media_mime: null, media_url: null, from_phone: null, to_phone: null,
    wa_timestamp: date, created_at: date, sent_by: null, error: null, transcription: null, ...patch,
  };
}
function chat(patch: Partial<WaChatData> = {}): WaChatData {
  return {
    connected: true, hasConnection: true, provider: 'evolution', senders: [one, two],
    conversation: null, messages: [message('one', '2026-10-19T12:00:00Z')], ...patch,
  };
}
type Props = Parameters<typeof useConversationSender>[0];
function mount(initialProps: Props = { data: chat() }) {
  return renderHook((props: Props) => useConversationSender(props), { initialProps });
}
async function authorize(result: ReturnType<typeof mount>['result']) {
  let permit: SenderPermit | null = null;
  await act(async () => { permit = await result.current.authorize(); });
  return permit;
}
afterEach(() => localStorage.clear());

describe('conversation sender selection', () => {
  it('uses the latest settled message by timestamp and ignores global browser preference', () => {
    localStorage.setItem('wa-sender-connection', 'one');
    const { result } = mount({ data: chat({ messages: [
      message('two', '2026-10-20T10:00:00Z'),
      message('one', '2026-10-20T11:00:00Z', { status: 'failed' }),
      message('one', '2026-10-20T12:00:00Z', { status: 'pending' }),
      message('one', '2026-10-20T13:00:00Z', { id: 'temp-123' }),
      message('one', '2026-10-20T14:00:00Z', { status: 'queued' }),
      message('one', '2026-10-19T15:00:00Z'),
    ] }) });
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBe('two');
    expect(localStorage.getItem('wa-sender-connection')).toBe('one');
  });

  it('uses a valid creation timestamp when the WhatsApp timestamp is invalid', () => {
    const { result } = mount({ data: chat({ messages: [
      message('one', '2026-10-19T12:00:00Z'),
      message('two', 'invalid', { created_at: '2026-10-20T12:00:00Z' }),
    ] }) });
    expect(result.current.activeSender?.id).toBe('two');
  });

  it('prefers the explicit opened conversation, then never changes it on polling', () => {
    const { result, rerender } = mount({ data: chat(), initialSenderId: 'two' });
    expect(result.current.referenceSenderId).toBe('two');
    act(() => result.current.selectSender('one'));
    rerender({ data: chat({ messages: [message('two', '2026-10-20T15:00:00Z')] }), initialSenderId: 'two' });
    expect(result.current.activeSender?.id).toBe('one');
    expect(result.current.referenceSenderId).toBe('two');
  });

  it('waits for the first response and freezes its reference after loading', () => {
    const { result, rerender } = mount({});
    expect(result.current.activeSender).toBeNull();
    rerender({ data: chat({ messages: [message('two', '2026-10-20T15:00:00Z')] }) });
    expect(result.current.activeSender?.id).toBe('two');
    rerender({ data: chat() });
    expect(result.current.activeSender?.id).toBe('two');
  });

  it('uses an unordered conversation connection only as a suggestion without valid history', async () => {
    const conversation = { id: 'conv', wa_phone: '+5544444444444', wa_name: null, contact_id: null, connection_id: 'two' };
    const { result, rerender } = mount({ data: chat({ conversation, messages: [] }) });
    expect(result.current.referenceSenderId).toBeNull();
    expect(result.current.activeSender?.id).toBe('two');
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    expect(result.current.confirmation).toEqual({ fromId: null, to: two });
    act(() => result.current.cancel());
    expect(await pending).toBeNull();
    rerender({ data: chat({ conversation: { ...conversation, connection_id: 'one' }, messages: [] }) });
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBeNull();
    const withHistory = mount({ data: chat({ conversation }) });
    expect(withHistory.result.current.referenceSenderId).toBe('one');
  });

  it.each([
    { status: 'failed' },
    { status: 'pending' },
    { id: 'temp-123' },
  ])('requires first-send confirmation when the only history is $status $id', async patch => {
    const conversation = { id: 'conv', wa_phone: '+5544444444444', wa_name: null, contact_id: null, connection_id: 'two' };
    const { result } = mount({ data: chat({
      conversation,
      messages: [message('two', '2026-10-20T15:00:00Z', patch)],
    }) });
    expect(result.current.referenceSenderId).toBeNull();
    expect(result.current.activeSender?.id).toBe('two');
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    expect(result.current.confirmation).toEqual({ fromId: null, to: two });
    act(() => result.current.cancel());
    expect(await pending).toBeNull();
  });

  it('initializes from actual history after the first disconnected response, then preserves manual choice', async () => {
    const { result, rerender } = mount({ data: chat({ connected: false, senders: [], messages: [], conversation: null }) });
    expect(await authorize(result)).toBeNull();
    const restored = chat({ messages: [
      message('two', '2026-10-20T15:00:00Z'), message('one', '2026-10-19T15:00:00Z'),
    ] });
    rerender({ data: restored });
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBe('two');
    expect((await authorize(result))?.sender.id).toBe('two');
    act(() => result.current.selectSender('one'));
    rerender({ data: { ...restored } });
    expect(result.current.activeSender?.id).toBe('one');
    expect(result.current.referenceSenderId).toBe('two');
  });

  it('retains a fixed sender through the first disconnected response without substituting another number', async () => {
    const { result, rerender } = mount({
      data: chat({ connected: false, senders: [], messages: [] }), fixedConnectionId: 'two',
    });
    expect(result.current.activeSender).toBeNull();
    expect(await authorize(result)).toBeNull();
    rerender({ data: chat({ senders: [one] }), fixedConnectionId: 'two' });
    expect(result.current.activeSender).toBeNull();
    expect(await authorize(result)).toBeNull();
    rerender({ data: chat(), fixedConnectionId: 'two' });
    expect(result.current.activeSender?.id).toBe('two');
    expect((await authorize(result))?.sender.id).toBe('two');
  });

  it('does not infer a historical sender from messages missing valid time or connection', () => {
    const { result } = mount({ data: chat({ messages: [
      message('two', 'invalid'), message(null, '2026-10-20T15:00:00Z'),
    ] }) });
    expect(result.current.referenceSenderId).toBeNull();
    expect(result.current.activeSender?.id).toBe('one');
  });

  it('keeps fixed conversations on their connection, without fallback', async () => {
    const { result, rerender } = mount({ data: chat(), fixedConnectionId: 'two', initialSenderId: 'one' });
    act(() => result.current.selectSender('one'));
    expect(result.current.activeSender?.id).toBe('two');
    const permit = await authorize(result);
    expect(permit?.sender.id).toBe('two');
    rerender({ data: chat({ senders: [one] }), fixedConnectionId: 'two' });
    expect(result.current.activeSender).toBeNull();
    expect(await authorize(result)).toBeNull();
    expect(result.current.isCurrent(permit!)).toBe(false);
  });
});

describe('per-attempt sender confirmation', () => {
  it('allows the sole sender without a warning for a new conversation', async () => {
    const { result } = mount({ data: chat({ senders: [two], messages: [] }) });
    expect((await authorize(result))?.sender.id).toBe('two');
    expect(result.current.confirmation).toBeNull();
  });

  it('allows a sole sender that connects after an initially disconnected empty conversation', async () => {
    const { result, rerender } = mount({ data: chat({ connected: false, senders: [], messages: [] }) });
    expect(await authorize(result)).toBeNull();
    rerender({ data: chat({ senders: [two], messages: [] }) });
    expect((await authorize(result))?.sender.id).toBe('two');
    expect(result.current.confirmation).toBeNull();
  });

  it('requires confirmation for the first send without history when several senders exist', async () => {
    const { result } = mount({ data: chat({ messages: [] }) });
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    expect(result.current.confirmation).toEqual({ fromId: null, to: one });
    act(() => result.current.confirm());
    const permit = await pending;
    expect(permit?.sender.id).toBe('one');
    expect(result.current.referenceSenderId).toBeNull();
    act(() => result.current.markSent(permit!));
    expect(result.current.referenceSenderId).toBe('one');
    expect((await authorize(result))?.sender.id).toBe('one');
  });

  it('confirms a switch once per attempt, and only success establishes the new reference', async () => {
    const { result } = mount();
    act(() => result.current.selectSender('two'));
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    expect(result.current.confirmation).toEqual({ fromId: 'one', to: two });
    expect(await authorize(result)).toBeNull(); // duplicate click cannot receive a second permit
    act(() => { result.current.confirm(); result.current.confirm(); });
    const failedAttempt = await pending;
    expect(result.current.isCurrent(failedAttempt!)).toBe(true);
    expect(result.current.referenceSenderId).toBe('one');
    // No markSent on transport failure: retry asks again.
    act(() => { pending = result.current.authorize(); });
    expect(result.current.confirmation?.fromId).toBe('one');
    act(() => result.current.confirm());
    const successfulAttempt = await pending;
    act(() => result.current.markSent(successfulAttempt!));
    expect(result.current.referenceSenderId).toBe('two');
    expect(result.current.isCurrent(successfulAttempt!)).toBe(false); // consumed by success
    expect((await authorize(result))?.sender.id).toBe('two');
  });

  it('cancel resolves pending authorization without changing selection or reference', async () => {
    const { result } = mount();
    act(() => result.current.selectSender('two'));
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    act(() => result.current.cancel());
    expect(await pending).toBeNull();
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBe('one');
    act(() => result.current.confirm());
    expect(result.current.confirmation).toBeNull();
  });

  it('usePrevious cancels the attempt and selects the reference when it is available', async () => {
    const { result } = mount();
    act(() => result.current.selectSender('two'));
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    act(() => result.current.usePrevious());
    expect(await pending).toBeNull();
    expect(result.current.activeSender?.id).toBe('one');
  });

  it('requires confirmation when the historical sender is unavailable, even with one sender left', async () => {
    const { result } = mount({ data: chat({ senders: [two] }) });
    expect(result.current.activeSender?.id).toBe('two');
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    expect(result.current.confirmation?.fromId).toBe('one');
    act(() => result.current.usePrevious());
    expect(await pending).toBeNull();
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBe('one');
  });
});

describe('authorization lifetime', () => {
  it('keeps the authorized sender snapshot immutable and rejects copied permits', async () => {
    const { result } = mount();
    const permit = await authorize(result);
    expect(Object.isFrozen(permit)).toBe(true);
    expect(Object.isFrozen(permit!.sender)).toBe(true);
    expect(result.current.isCurrent({ ...permit! })).toBe(false);
  });

  it('revokes pending authorization and permits when selection changes, even if changed back', async () => {
    const { result } = mount();
    const permit = await authorize(result);
    act(() => result.current.selectSender('two'));
    expect(result.current.isCurrent(permit!)).toBe(false);
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    act(() => result.current.selectSender('one'));
    expect(await pending).toBeNull();
    expect(result.current.isCurrent(permit!)).toBe(false);
    act(() => result.current.markSent(permit!));
    expect(result.current.referenceSenderId).toBe('one');
  });

  it('revokes an issued permit on disconnection and does not revive it on reconnection', async () => {
    const { result, rerender } = mount();
    const permit = await authorize(result);
    rerender({ data: chat({ senders: [two] }) });
    expect(result.current.isCurrent(permit!)).toBe(false);
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBe('one');
    rerender({ data: chat() });
    act(() => result.current.selectSender('one'));
    expect(result.current.isCurrent(permit!)).toBe(false);
  });

  it('cancels pending confirmation when its sender disconnects', async () => {
    const { result, rerender } = mount();
    act(() => result.current.selectSender('two'));
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    rerender({ data: chat({ senders: [one] }) });
    expect(await pending).toBeNull();
    expect(result.current.confirmation).toBeNull();
  });

  it('revokes authorization while data is unavailable or the organization is disconnected', async () => {
    const { result, rerender } = mount();
    const permit = await authorize(result);
    rerender({});
    expect(result.current.isCurrent(permit!)).toBe(false);
    expect(await authorize(result)).toBeNull();
    rerender({ data: chat({ connected: false }) });
    expect(await authorize(result)).toBeNull();
  });

  it('reinitializes when an explicit deep link changes without remounting', async () => {
    const { result, rerender } = mount({ data: chat(), initialSenderId: 'one' });
    const permit = await authorize(result);
    act(() => result.current.selectSender('two'));
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    rerender({ data: chat(), initialSenderId: 'two' });
    expect(await pending).toBeNull();
    expect(result.current.isCurrent(permit!)).toBe(false);
    expect(result.current.activeSender?.id).toBe('two');
    expect(result.current.referenceSenderId).toBe('two');
  });

  it('invalidates all attempts when unmounted and keeps the next contact independent', async () => {
    const { result, unmount } = mount();
    const priorApi = result.current;
    const permit = await authorize(result);
    act(() => result.current.selectSender('two'));
    let pending!: Promise<SenderPermit | null>;
    act(() => { pending = result.current.authorize(); });
    unmount();
    expect(await pending).toBeNull();
    expect(priorApi.isCurrent(permit!)).toBe(false);
    expect(await priorApi.authorize()).toBeNull();
    const next = mount({ data: chat({ messages: [message('two', '2026-10-20T15:00:00Z')] }) });
    expect(next.result.current.activeSender?.id).toBe('two');
    expect(next.result.current.isCurrent(permit!)).toBe(false);
  });

  it('does not revoke permits merely because polling returns new objects', async () => {
    const { result, rerender } = mount();
    const permit = await authorize(result);
    rerender({ data: chat({ senders: [{ ...one }, { ...two }, third] }) });
    expect(result.current.isCurrent(permit!)).toBe(true);
  });

  it('remains usable under React StrictMode effect replay', async () => {
    const { result } = renderHook(() => useConversationSender({ data: chat() }), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    const permit = await authorize(result);
    expect(permit?.sender.id).toBe('one');
    expect(result.current.isCurrent(permit!)).toBe(true);
  });
});
