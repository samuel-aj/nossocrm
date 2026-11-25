import React, { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallBanner } from './InstallBanner';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DISMISS_KEY = 'pwa_install_dismissed_at';
const DAY = 24 * 60 * 60 * 1000;

type TestNavigator = { userAgent?: string; standalone?: boolean };
let root: Root | null = null;
let container: HTMLElement | null = null;

// Renderiza como o servidor (sem `window`) e hidrata como o navegador do aparelho,
// do mesmo jeito que o Next faz com o aviso no layout raiz.
async function hydrateAs(userAgent: string) {
  vi.stubGlobal('window', undefined);
  let serverHtml: string;
  try {
    serverHtml = renderToString(<InstallBanner />);
  } finally {
    vi.unstubAllGlobals();
  }

  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => userAgent });
  const host = document.createElement('div');
  host.innerHTML = serverHtml;
  document.body.appendChild(host);
  container = host;

  const hydrationErrors: string[] = [];
  await act(async () => {
    root = hydrateRoot(host, <InstallBanner />, {
      onRecoverableError: (error) => hydrationErrors.push(String((error as Error)?.message ?? error)),
    });
  });
  return { serverHtml, hydrationErrors, banner: () => host.querySelector('[data-install-banner]') };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  delete (window.navigator as TestNavigator).userAgent;
  delete (window.navigator as TestNavigator).standalone;
});

describe('InstallBanner', () => {
  it('no iPhone, hidrata sem divergir do servidor e só então mostra o aviso', async () => {
    const { serverHtml, hydrationErrors, banner } = await hydrateAs(IPHONE);

    expect(serverHtml).toBe('');
    expect(hydrationErrors).toEqual([]);
    expect(banner()).toHaveTextContent('No iPhone/iPad: toque em Compartilhar → “Adicionar à Tela de Início”.');
  });

  it('no computador, não mostra o aviso', async () => {
    const { hydrationErrors, banner } = await hydrateAs(DESKTOP);

    expect(hydrationErrors).toEqual([]);
    expect(banner()).toBeNull();
  });

  it('no Android, só mostra o aviso quando o navegador oferece a instalação', async () => {
    const { hydrationErrors, banner } = await hydrateAs(ANDROID);
    expect(hydrationErrors).toEqual([]);
    expect(banner()).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('beforeinstallprompt'));
    });

    expect(banner()).toHaveTextContent('Instale para abrir mais rápido e usar como app.');
    expect(banner()?.querySelector('button')).toHaveTextContent('Instalar');
  });

  it('respeita a dispensa por 7 dias', async () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() - 6 * DAY));
    const recent = await hydrateAs(IPHONE);
    expect(recent.hydrationErrors).toEqual([]);
    expect(recent.banner()).toBeNull();

    await act(async () => root?.unmount());
    container?.remove();

    localStorage.setItem(DISMISS_KEY, String(Date.now() - 8 * DAY));
    const expired = await hydrateAs(IPHONE);
    expect(expired.banner()).not.toBeNull();
  });

  it('grava a dispensa e some ao tocar em "Entendi"', async () => {
    const { banner } = await hydrateAs(IPHONE);
    const before = Date.now();

    await act(async () => {
      Array.from(banner()?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent?.trim() === 'Entendi')
        ?.click();
    });

    expect(banner()).toBeNull();
    expect(Number(localStorage.getItem(DISMISS_KEY))).toBeGreaterThanOrEqual(before);
  });

  it('não mostra o aviso no app já instalado', async () => {
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
    const { hydrationErrors, banner } = await hydrateAs(IPHONE);

    expect(hydrationErrors).toEqual([]);
    expect(banner()).toBeNull();
  });
});
