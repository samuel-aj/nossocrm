import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { WaChatData, WaChatMessage, WaSender } from './useWhatsAppChat';

/** A permit belongs to one attempt in this mounted conversation session. */
export type SenderPermit = {
  readonly sender: WaSender;
  readonly token: symbol;
};

type SenderConfirmation = { fromId: string | null; to: WaSender };
type Options = {
  data?: WaChatData;
  initialSenderId?: string | null;
  fixedConnectionId?: string | null;
};
type Selection = {
  initialized: boolean;
  selectedSenderId: string | null;
  referenceSenderId: string | null;
  version: symbol;
};
type Pending = {
  confirmation: SenderConfirmation;
  version: symbol;
  resolve: (permit: SenderPermit | null) => void;
};

function connectedSenders(data?: WaChatData): WaSender[] {
  return data?.connected && data.hasConnection ? data.senders : [];
}

function isHistoryMessage(message: WaChatMessage): boolean {
  return !message.id.startsWith('temp-') &&
    !['failed', 'pending', 'queued', 'sending', 'error'].includes(message.status.toLowerCase());
}

function messageTime(message: WaChatMessage): number {
  const sentAt = Date.parse(message.wa_timestamp ?? '');
  return Number.isFinite(sentAt) ? sentAt : Date.parse(message.created_at);
}

function initialSelection({ data, initialSenderId, fixedConnectionId }: Options): Selection {
  const senders = connectedSenders(data);
  const history = (data?.messages ?? []).filter(isHistoryMessage);
  const latest = history
    .filter(message => message.connection_id && Number.isFinite(messageTime(message)))
    .reduce<WaChatMessage | null>((current, message) =>
      !current || messageTime(message) > messageTime(current) ? message : current, null);
  // The API's "conversation" is not ordered by recency. With no valid history
  // it can suggest a selection, but cannot authorize the first send.
  const referenceSenderId = fixedConnectionId ?? initialSenderId ?? latest?.connection_id ??
    (senders.length === 1 ? senders[0].id : null);
  const suggestedSenderId = referenceSenderId ?? (!latest ? data?.conversation?.connection_id : null);
  return {
    // Disconnected responses deliberately omit history. Wait until the first
    // connected response before freezing the conversation's reference.
    initialized: !!(data?.connected && data.hasConnection),
    referenceSenderId,
    selectedSenderId: fixedConnectionId ??
      senders.find(sender => sender.id === suggestedSenderId)?.id ?? senders[0]?.id ?? null,
    version: Symbol('conversation-sender-session'),
  };
}

export function useConversationSender({
  data,
  initialSenderId = null,
  fixedConnectionId = null,
}: Options) {
  const [selection, setSelection] = useState(() => initialSelection({ data, initialSenderId, fixedConnectionId }));
  const [confirmation, setConfirmation] = useState<SenderConfirmation | null>(null);
  const selectionRef = useRef(selection);
  const contextRef = useRef({ data, initialSenderId, fixedConnectionId });
  const mountedRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const issuedRef = useRef(new Map<symbol, { permit: SenderPermit; version: symbol }>());

  const commit = useCallback((next: Selection) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const dismissPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (mountedRef.current) setConfirmation(null);
    pending?.resolve(null);
  }, []);

  const invalidate = useCallback(() => {
    issuedRef.current.clear();
    dismissPending();
  }, [dismissPending]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidate();
    };
  }, [invalidate]);

  useLayoutEffect(() => {
    const previous = contextRef.current;
    contextRef.current = { data, initialSenderId, fixedConnectionId };
    const current = selectionRef.current;
    if (previous.initialSenderId !== initialSenderId ||
        previous.fixedConnectionId !== fixedConnectionId ||
        (!current.initialized && data?.connected && data.hasConnection)) {
      invalidate();
      commit(initialSelection({ data, initialSenderId, fixedConnectionId }));
      return;
    }

    const available = connectedSenders(data);
    const selectedAvailable = available.some(sender => sender.id === current.selectedSenderId);
    // Losing a connection revokes permits even if the same number reconnects.
    // Keep the historical reference so falling back requires confirmation.
    const nextId = fixedConnectionId ?? (selectedAvailable ? current.selectedSenderId : available[0]?.id ?? current.selectedSenderId);
    const lostSender = connectedSenders(previous.data).some(sender => sender.id === current.selectedSenderId) && !selectedAvailable;
    if (nextId !== current.selectedSenderId || lostSender) {
      invalidate();
      commit({ ...current, selectedSenderId: nextId, version: Symbol('sender-changed') });
    }
  }, [data, initialSenderId, fixedConnectionId, commit, invalidate]);

  const currentSender = useCallback(() => {
    if (!mountedRef.current || !selectionRef.current.initialized) return null;
    const context = contextRef.current;
    const id = context.fixedConnectionId ?? selectionRef.current.selectedSenderId;
    return connectedSenders(context.data).find(sender => sender.id === id) ?? null;
  }, []);

  const issue = useCallback((sender: WaSender): SenderPermit => {
    const permit: SenderPermit = Object.freeze({
      sender: Object.freeze({ ...sender }),
      token: Symbol('sender-attempt'),
    });
    issuedRef.current.set(permit.token, { permit, version: selectionRef.current.version });
    return permit;
  }, []);

  const isCurrent = useCallback((permit: SenderPermit): boolean => {
    const issued = issuedRef.current.get(permit.token);
    return !!issued && issued.permit === permit &&
      issued.version === selectionRef.current.version &&
      currentSender()?.id === permit.sender.id;
  }, [currentSender]);

  const selectSender = useCallback((id: string) => {
    const context = contextRef.current;
    if (!mountedRef.current || context.fixedConnectionId ||
        !connectedSenders(context.data).some(sender => sender.id === id) ||
        selectionRef.current.selectedSenderId === id) return;
    invalidate();
    commit({ ...selectionRef.current, selectedSenderId: id, version: Symbol('sender-changed') });
  }, [commit, invalidate]);

  const authorize = useCallback((): Promise<SenderPermit | null> => {
    const sender = currentSender();
    if (!sender || pendingRef.current) return Promise.resolve(null);
    const current = selectionRef.current;
    if (contextRef.current.fixedConnectionId || current.referenceSenderId === sender.id ||
        (!current.referenceSenderId && connectedSenders(contextRef.current.data).length === 1)) {
      return Promise.resolve(issue(sender));
    }
    const nextConfirmation = { fromId: current.referenceSenderId, to: { ...sender } };
    return new Promise(resolve => {
      pendingRef.current = { confirmation: nextConfirmation, version: current.version, resolve };
      setConfirmation(nextConfirmation);
    });
  }, [currentSender, issue]);

  const confirm = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const sender = currentSender();
    pendingRef.current = null;
    setConfirmation(null);
    pending.resolve(
      sender?.id === pending.confirmation.to.id && pending.version === selectionRef.current.version
        ? issue(sender)
        : null
    );
  }, [currentSender, issue]);

  const cancel = useCallback(() => {
    invalidate();
  }, [invalidate]);

  const usePrevious = useCallback(() => {
    invalidate();
    const reference = selectionRef.current.referenceSenderId;
    if (reference) selectSender(reference);
  }, [invalidate, selectSender]);

  const markSent = useCallback((permit: SenderPermit) => {
    if (!isCurrent(permit)) return;
    issuedRef.current.delete(permit.token);
    commit({ ...selectionRef.current, referenceSenderId: permit.sender.id });
  }, [commit, isCurrent]);

  const activeSender = connectedSenders(data).find(sender =>
    sender.id === (fixedConnectionId ?? selection.selectedSenderId)) ?? null;

  return {
    activeSender,
    selectedSenderId: selection.selectedSenderId,
    referenceSenderId: selection.referenceSenderId,
    confirmation,
    selectSender,
    authorize,
    isCurrent,
    markSent,
    confirm,
    cancel,
    usePrevious,
  };
}
