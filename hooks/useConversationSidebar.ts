'use client';

import { useLayoutEffect, useRef } from 'react';
import { useCRM } from '@/context/CRMContext';

/** Recolhe a navegação quando a pessoa escolhe outra conversa. */
export function useConversationSidebar(selectionKey: string | null) {
  const { sidebarCollapsed, setSidebarCollapsed } = useCRM();
  const previousKey = useRef<string | null>(null);
  const entryCollapsed = useRef<boolean | null>(null);
  const manualOverride = useRef(false);
  const expectedChange = useRef<boolean | null>(null);
  const observedCollapsed = useRef(sidebarCollapsed);
  const currentCollapsed = useRef(sidebarCollapsed);
  const setter = useRef(setSidebarCollapsed);

  useLayoutEffect(() => {
    currentCollapsed.current = sidebarCollapsed;
    setter.current = setSidebarCollapsed;
  }, [sidebarCollapsed, setSidebarCollapsed]);

  useLayoutEffect(() => {
    const prior = previousKey.current;
    const changed = selectionKey !== prior;
    if (changed) {
      previousKey.current = selectionKey;
      if (selectionKey) {
        if (!prior) {
          entryCollapsed.current = sidebarCollapsed;
          manualOverride.current = false;
        }
        if (!sidebarCollapsed) {
          expectedChange.current = true;
          setSidebarCollapsed(true);
        }
      } else {
        if (entryCollapsed.current === false && !manualOverride.current && sidebarCollapsed) {
          expectedChange.current = false;
          setSidebarCollapsed(false);
        }
        entryCollapsed.current = null;
        manualOverride.current = false;
      }
    } else if (sidebarCollapsed !== observedCollapsed.current) {
      if (expectedChange.current === sidebarCollapsed) expectedChange.current = null;
      else if (selectionKey) manualOverride.current = true;
    }
    observedCollapsed.current = sidebarCollapsed;
  }, [selectionKey, sidebarCollapsed, setSidebarCollapsed]);

  useLayoutEffect(() => () => {
    if (previousKey.current && entryCollapsed.current === false && !manualOverride.current && currentCollapsed.current) {
      setter.current(false);
    }
  }, []);
}
