'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'pwa_install_dismissed_at';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface InstallState {
  isStandalone: boolean;
  isEligible: boolean;
  canPrompt: boolean;
  isDismissed: boolean;
  promptInstall: () => Promise<void>;
  dismiss: () => void;
  platformHint: 'ios' | 'android' | 'desktop' | 'unknown';
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari
  // @ts-expect-error - iOS Safari standalone
  if (window.navigator?.standalone) return true;
  // Modern browsers
  return window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
}

function platformHint(): InstallState['platformHint'] {
  if (typeof window === 'undefined') return 'unknown';
  const ua = window.navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

// No servidor e durante a hidratação vale `false`; logo depois o React renderiza de novo com `true`.
// Tudo o que depende do aparelho (iPhone, app instalado, dispensa gravada) só entra na tela a partir daí:
// antes, o iPhone renderizava o aviso já na hidratação, o HTML do servidor não batia e o React refazia a página.
const subscribeNever = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function useInstallState(): InstallState {
  const hydrated = useHydrated();
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState<boolean>(() => detectStandalone());
  const [dismissedAt, setDismissedAt] = useState<number | null>(() => (typeof window === 'undefined' ? null : readDismissedAt()));

  useEffect(() => {
    setStandalone(detectStandalone());
    const mm = window.matchMedia?.('(display-mode: standalone)');
    const onChange = () => setStandalone(detectStandalone());
    mm?.addEventListener?.('change', onChange);
    window.addEventListener('visibilitychange', onChange);
    return () => {
      mm?.removeEventListener?.('change', onChange);
      window.removeEventListener('visibilitychange', onChange);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      // Chrome/Edge only
      e.preventDefault?.();
      setBipEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  const isDismissed = useMemo(() => {
    if (!dismissedAt) return false;
    return Date.now() - dismissedAt < COOLDOWN_MS;
  }, [dismissedAt]);

  const isEligible = useMemo(() => {
    if (standalone) return false;
    const platform = platformHint();
    // Só mostra em mobile/tablet — desktop não precisa de PWA
    if (platform === 'desktop') return false;
    // If browser supports native prompt, we consider eligible (when event is captured).
    if (bipEvent) return true;
    // iOS: no native prompt; show instructional banner (still eligible).
    return platform === 'ios';
  }, [bipEvent, standalone]);

  const canPrompt = useMemo(() => !!bipEvent, [bipEvent]);

  const promptInstall = async () => {
    if (!bipEvent) return;
    await bipEvent.prompt();
    try {
      await bipEvent.userChoice;
    } finally {
      setBipEvent(null);
    }
  };

  const dismiss = () => {
    try {
      const t = Date.now();
      localStorage.setItem(DISMISS_KEY, String(t));
      setDismissedAt(t);
    } catch {
      // noop
    }
  };

  return {
    isStandalone: hydrated && standalone,
    isEligible: hydrated && isEligible,
    canPrompt,
    isDismissed: hydrated && isDismissed,
    promptInstall,
    dismiss,
    platformHint: hydrated ? platformHint() : 'unknown',
  };
}

