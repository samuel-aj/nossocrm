import { describe, expect, it } from 'vitest';
import { buildMediaBlock } from './context';
import type { AgentMediaRow } from './types';

const media: AgentMediaRow = {
  id: 'media', organization_id: 'org', agent_id: 'agent', name: 'boas vindas',
  description: 'Na chegada', kind: 'video', mime: 'video/mp4', size_bytes: 10,
  storage_path: 'org/agent/video.mp4', created_at: '2026-11-14T10:00:00Z',
};

describe('dynamic context honors the repetition preference of each media', () => {
  it.each([undefined, true])('keeps once-per-conversation protection for setting %s', setting => {
    const block = buildMediaBlock([{ ...media, send_once_per_conversation: setting }], ['boas vindas']);
    expect(block).toContain('[uma vez por conversa]');
    expect(block).toContain('JÁ ENVIADA');
    expect(block).not.toContain('reenvio permitido');
  });

  it('distinguishes repeatable media from protected media even when both were previously sent', () => {
    const rows = [media, { ...media, id: 'other', name: 'tutorial', send_once_per_conversation: false }];
    const before = structuredClone(rows);
    const block = buildMediaBlock(rows, ['boas vindas', 'tutorial']);
    const welcome = block.split('\n').find(line => line.includes('"boas vindas"'));
    const tutorial = block.split('\n').find(line => line.includes('"tutorial"'));
    expect(welcome).toContain('JÁ ENVIADA');
    expect(tutorial).toContain('[reenvio permitido após 1 minuto]');
    expect(tutorial).not.toContain('JÁ ENVIADA');
    expect(tutorial).not.toContain('uma vez por conversa');
    expect(rows).toEqual(before);
  });
});
