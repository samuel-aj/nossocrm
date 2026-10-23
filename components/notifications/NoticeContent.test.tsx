import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { NoticeContent, noticeTone } from './NoticeContent';
import type { Notice } from '@/lib/notifications/types';
const notice: Notice = { id: '1', kind: 'alert', title: 'Nova mensagem', message: 'O lead respondeu', href: '/chats', createdAt: '2026-10-23' };
it('distinguishes lead messages, attention and IA by explicit category, not title or ID', () => {
  expect(noticeTone(notice)).toBe('green');
  expect(noticeTone({ ...notice, tone: 'red' })).toBe('red');
  expect(noticeTone({ ...notice, category: 'ai_usage', tone: 'red' })).toBe('violet');
  const misleadingTitle: Notice = { ...notice, title: 'IA pausada por limite', id: 'ai-usage-fake' };
  expect(noticeTone(misleadingTitle)).toBe('green');
  render(<NoticeContent notice={{ ...notice, category: 'ai_usage', title: 'IA pausada por limite' }} time="agora" />);
  expect(screen.getByText('IA pausada por limite')).toBeVisible();
  expect(screen.getByText('agora')).toBeVisible();
});
