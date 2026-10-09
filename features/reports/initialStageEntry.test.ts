import { expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

it('inclui uma chegada inicial registrada pelo banco mesmo com relógios de criação diferentes', () => {
  const a = lead('a', { createdAt: '2026-08-01T00:00:00.000Z' });
  const date = '2026-08-01T00:00:00.331Z';
  const events = [{ ...movement(a.id, 'q', date), isInitialArrival: true }];
  const data = calculatePerformance([a], events, board, august, '', undefined, snapshot, { mode: 'period' });
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0]).toMatchObject({ id: a.id, createdAt: a.createdAt, updatedAt: date });
  expect(data.leadSourceTotal).toBe(1);
  expect(data.entryFunnel.stages.map(stage => stage.count)).toEqual([1, 1, 0, 0, 0]);
  expect(events[0].date).toBe(date);
  expect(a.qualifiedAt).toBeUndefined();
});

it('usa a data da chegada inicial, inclusive para transferências ou atribuições de etapa posteriores à criação', () => {
  const a = lead('old-created', { createdAt: '2026-07-01' });
  const arrival = { ...movement(a.id, 'proposal', '2026-08-05T12:00:00Z'), isInitialArrival: true };
  const data = calculatePerformance([a], [arrival], board, august, '', undefined, snapshot, { mode: 'period' });
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0].createdAt).toBe('2026-07-01');
  expect(data.entries[0].updatedAt).toBe(arrival.date);
  expect(data.entryFunnel.stages.map(stage => stage.count)).toEqual([1, 1, 1, 0, 0]);
});

it('não transforma uma atividade de origem desconhecida em entrada nem repete entrada autoritativa', () => {
  const a = lead('a');
  const unknown = calculatePerformance([a], [movement(a.id, 'q', '2026-08-05')], board, august, '', undefined, snapshot, { mode: 'period' });
  expect(unknown.entries).toHaveLength(0);
  expect(unknown.entryFunnel.baseCount).toBe(0);
  const events = [{ ...movement(a.id, 'q', '2026-08-05'), isInitialArrival: true }];
  const authoritative = lifecycle(a, 'entered_board', '2026-08-01', { ownerId: 'original', owner: { name: 'Original', avatar: '' } });
  const data = calculatePerformance([a], events, board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: [authoritative] });
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0]).toMatchObject({ ownerId: 'original', updatedAt: '2026-08-01' });
});

it('não antecipa uma chegada inicial para o período da criação nem aceita outro funil', () => {
  const a = lead('a');
  const events = [
    { ...movement(a.id, 'q', '2026-09-01'), isInitialArrival: true },
    { ...movement(a.id, 'q', '2026-08-05'), boardId: 'other', isInitialArrival: true },
  ];
  const data = calculatePerformance([a], events, board, august, '', undefined, snapshot, { mode: 'period' });
  expect(data.entries).toHaveLength(0);
  expect(data.entryFunnel.stages.every(stage => stage.count === 0)).toBe(true);
});
