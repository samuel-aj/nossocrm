import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const m = vi.hoisted(() => ({ authorized: vi.fn(), after: vi.fn(), monitor: vi.fn(), emails: vi.fn(), recover: vi.fn(), notices: vi.fn() }));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/wa-agents/internalAuth', () => ({ verifyInternalSecret: m.authorized }));
vi.mock('@/lib/whatsapp/connectionMonitor', () => ({ monitorConnections: m.monitor }));
vi.mock('@/lib/whatsapp/connectionIncidentEmail', () => ({ dispatchConnectionIncidentEmails: m.emails }));
vi.mock('@/lib/wa-agents/connectionRecovery', () => ({ processPendingConnectionReplies: m.recover }));
vi.mock('@/lib/zapsign/agentNotices', () => ({ processAgentNotices: m.notices }));
vi.mock('@/lib/wa-agents/engine', () => ({ resumeDueConversations: vi.fn() }));
vi.mock('@/lib/wa-agents/bots', () => ({ processDueBotRuns: vi.fn() }));
vi.mock('@/lib/wa-agents/followups', () => ({ processFollowups: vi.fn() }));
vi.mock('@/lib/wa-agents/stageFollowups', () => ({ processStageFollowups: vi.fn() }));
vi.mock('@/lib/wa-agents/dealStarts', () => ({ processDealStarts: vi.fn() }));
vi.mock('@/lib/zapsign/signatures', () => ({ processQueuedSignatures: vi.fn() }));
const tick = () => new Request('https://crm.invalid/api/wa-agents/tick', { method: 'POST', body: JSON.stringify({ job: 'connection_health' }) });

beforeEach(() => { vi.clearAllMocks(); m.monitor.mockResolvedValue(undefined); m.recover.mockResolvedValue({}); m.emails.mockResolvedValue({}); });
it('somente o cron autenticado inicia a verificação', async () => {
  m.authorized.mockReturnValue(false);
  expect((await POST(tick())).status).toBe(401);
  expect(m.after).not.toHaveBeenCalled();
});
it('confere a linha antes da recuperação e não inicia atendimento ou contratos pelo relógio de monitoramento', async () => {
  m.authorized.mockReturnValue(true);
  expect((await POST(tick())).status).toBe(202);
  await m.after.mock.calls[0][0]();
  expect(m.emails).toHaveBeenCalledOnce();
  expect(m.monitor.mock.invocationCallOrder[0]).toBeLessThan(m.recover.mock.invocationCallOrder[0]);
  expect(m.notices).not.toHaveBeenCalled();
});
