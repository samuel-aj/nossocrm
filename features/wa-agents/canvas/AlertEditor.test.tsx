import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AlertEditor } from './AlertEditor';
import { botToFlow, flowToBot } from './serialize';
import type { BlockOfType, BubbleNode } from './types';
import type { BotRow } from '@/lib/wa-agents/types';

it('opens an old alert as green and saves red while preserving edited text through reload', () => {
  const flow = botToFlow({ id: 'bot', name: 'Alertas', enabled: false, trigger: { type: 'manual' }, steps: [
    { id: 'alert', type: 'activate_alert', message: 'Nova mensagem' },
  ], start_step_id: 'alert', layout: { groups: [] } } as unknown as BotRow, []);
  const bubble = flow.nodes.find(n => n.type === 'bubble') as BubbleNode;
  const initial = bubble.data.blocks[0] as BlockOfType<'activate_alert'>;
  let updated = initial;
  function Harness() {
    const [block, setBlock] = useState(initial);
    return <AlertEditor block={block} update={next => { updated = next; setBlock(next); }} />;
  }
  render(<Harness />);
  expect(screen.getByRole('radio', { name: 'Verde — Aviso' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Vermelho — Atenção' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto do alerta' }), { target: { value: 'Revisar documentos' } });
  expect(screen.getByRole('radio', { name: 'Vermelho — Atenção' })).toBeChecked();
  const saved = flowToBot(flow.nodes.map(n => n.id === bubble.id ? { ...bubble, data: { ...bubble.data, blocks: [updated] } } : n), flow.edges, { name: 'Alertas', enabled: false, connection_ids: [] });
  expect(saved.steps).toContainEqual(expect.objectContaining({ type: 'activate_alert', message: 'Revisar documentos', tone: 'red' }));
  const loaded = botToFlow({ ...saved, id: 'bot' } as unknown as BotRow, []);
  expect((loaded.nodes.find(n => n.type === 'bubble') as BubbleNode).data.blocks[0]).toMatchObject({ data: { message: 'Revisar documentos', tone: 'red' } });
  expect(screen.getAllByRole('radio')).toHaveLength(2);
});
