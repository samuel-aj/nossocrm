'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');

        // Monitor service worker updates
        registration.addEventListener('updatefound', () => {
        });
      } catch (err) {
        // noop (PWA is best-effort)
      }
    };

    register();
  }, []);

  return null;
}

