import { expect, it } from 'vitest';
import type { Board, DealView } from '@/types';
import { computeQualificationView } from './qualificationView';

it('keeps an open lead that skipped Customer visible in the Protocolado SQL column', () => {
  const board = { id: 'sales', wonStageId: 'protocol', stages: [
    { id: 'mql', label: 'Qualificado', linkedLifecycleStage: 'MQL' },
    { id: 'customer', label: 'Contrato', linkedLifecycleStage: 'CUSTOMER' },
    { id: 'protocol', label: 'Protocolado' },
  ] } as Board;
  const deals = [{ id: 'open', status: 'protocol', isWon: false }, { id: 'won', status: 'protocol', isWon: true }] as DealView[];
  const result = computeQualificationView(deals, board);
  expect(result.sqlCount).toBe(1);
  expect(result.sql.find(group => group.stage.id === 'protocol')?.deals.map(deal => deal.id)).toEqual(['open']);
  expect(result.sql.some(group => group.stage.id === 'customer')).toBe(false);
});
