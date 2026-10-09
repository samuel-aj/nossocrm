/** Synthetic fixture shared only by report presentation tests. No real CRM data. */
import { calculatePerformance } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

export function monthlyPresentationFixture() {
  const winners = Array.from({ length: 7 }, (_, index) => lead(`winner-${index + 1}`, {
    title: `Contrato ${index + 1}`, createdAt: index < 4 ? '2026-08-01T12:00:00Z' : '2026-07-01T12:00:00Z', status: 'won', isWon: true,
    closedAt: `2026-08-${String(index + 5).padStart(2, '0')}T12:00:00Z`, value: 100,
    leadSource: index === 0 ? 'Google Ads' : null,
    ...(index === 0 ? { ownerId: 'bia', owner: { name: 'Bia', avatar: '' },
      items: [{ id: 'current-product', productId: 'p2', name: 'Produto atual', price: 100, quantity: 1 }] } : {}),
  }));
  const observed = lead('observed', { title: 'Qualificação registrada na entrada', createdAt: '2026-08-01T12:00:00Z', status: 'proposal' });
  const notSigned = lead('not-signed', { title: 'Etapa Cliente sem contrato', createdAt: '2026-08-01T12:00:00Z', status: 'signed', isWon: false });
  const entrant = lead('entrant', { title: 'Entrada do mês', createdAt: '2026-08-01T12:00:00Z' });
  const extraEntries = Array.from({ length: 3 }, (_, index) => lead(`new-${index}`, { createdAt: entrant.createdAt }));
  const outside = lead('outside', { title: 'Ganho de outro mês', createdAt: '2026-07-01T12:00:00Z', status: 'won', isWon: true, closedAt: '2026-09-05T12:00:00Z' });
  const deals = [...winners, observed, notSigned, entrant, ...extraEntries, outside];
  const lifecycleEvents = [
    ...winners.slice(0, 6).flatMap(deal => [
      lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new', isWon: false,
        ...(deal.id === 'winner-1' ? { leadSource: 'Meta Ads', ownerId: 'ana', owner: { name: 'Ana', avatar: '' }, items: lead('old-product').items } : {}) }),
      lifecycle(deal, 'qualified', deal.createdAt.startsWith('2026-08') ? '2026-08-03T12:00:00Z' : '2026-07-04T12:00:00Z', { stageId: 'q', isWon: false }),
    ]),
    ...[observed, notSigned, entrant, ...extraEntries].map(deal => lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new', isWon: false })),
    lifecycle(observed, 'qualified', '2026-08-03T12:00:00Z', { stageId: 'q', isWon: false }),
    lifecycle(notSigned, 'qualified', '2026-08-04T12:00:00Z', { stageId: 'q', isWon: false }),
    lifecycle(notSigned, 'won', '2026-08-10T12:00:00Z', { stageId: 'signed' }),
  ];
  const stageEvents = [movement(observed.id, 'proposal', '2026-08-03T12:00:00Z', 'proposal'),
    movement(notSigned.id, 'signed', '2026-08-10T12:00:00Z', 'proposal')];
  const metrics = calculatePerformance(deals, stageEvents, board, august, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents });
  return { ...metrics, deals, board, lifecycleEvents, stageEvents, winners, observed, notSigned, entrant, outside };
}
