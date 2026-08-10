/**
 * @fileoverview Hook de Estado Persistido em localStorage
 *
 * Hook utilitário que sincroniza estado React com localStorage,
 * mantendo dados entre sessões do navegador e sincronizando
 * entre componentes da mesma aba via custom events.
 */

import React, { useState, useEffect, useRef } from 'react';

export const usePersistedState = <T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  // Always initialise with the static default so server and client
  // produce the same HTML on the first render (avoids hydration mismatch).
  const [state, setState] = useState<T>(initialValue);
  const hydrated = useRef(false);

  // After mount, read the real value from localStorage (client-only).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        const parsed = JSON.parse(item) as T;
        setState(parsed);
      }
    } catch {
      // ignore – keep initialValue
    }
  }, [key]);

  // Track if we dispatched the event ourselves to avoid re-applying our own update
  const isSelf = useRef(false);

  // Pula a PRIMEIRA gravação (a da montagem): ela escrevia o valor inicial
  // por cima do que estava salvo, antes de a hidratação acima aplicar o valor
  // real — quem lesse o localStorage nesse instante via o default, não o salvo.
  const firstPersist = useRef(true);

  // Persist to localStorage and notify other hook instances in the same tab
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
      isSelf.current = true;
      window.dispatchEvent(new CustomEvent(`__persisted_${key}`, { detail: state }));
    } catch (error) {
      console.error(`Error writing localStorage key "${key}":`, error);
    }
  }, [key, state]);

  // Listen for updates from other hook instances sharing the same key
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: CustomEvent) => {
      if (isSelf.current) {
        isSelf.current = false;
        return;
      }
      setState(e.detail as T);
    };
    window.addEventListener(`__persisted_${key}`, handler as EventListener);
    return () => window.removeEventListener(`__persisted_${key}`, handler as EventListener);
  }, [key]);

  return [state, setState];
};
