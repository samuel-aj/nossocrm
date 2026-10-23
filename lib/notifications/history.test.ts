import { expect, it } from 'vitest';
import { clearReadNotices, reconcileUsageNotices } from './history';
import type { Notice } from './types';
const base: Notice = { id: 'lead', kind: 'alert', title: 'Mensagem', message: 'Nova resposta', href: '/chats', createdAt: '2026-10-23' };
const ai: Notice = { ...base, id: 'ai', category: 'ai_usage', title: 'IA pausada por limite' };
it('clears ordinary notices without hiding an unresolved consumption block', () => {
  expect(clearReadNotices([base, ai])).toEqual([ai]);
});
it('removes a released block on refresh while preserving independent lead notices', () => {
  expect(reconcileUsageNotices([base, ai], [])).toEqual([base]);
  expect(reconcileUsageNotices([base], [ai])).toEqual([ai, base]);
  expect(reconcileUsageNotices([ai, base], [ai])).toEqual([ai, base]);
});
