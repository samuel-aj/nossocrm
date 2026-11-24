import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const m = vi.hoisted(() => ({ after: vi.fn(), authorized: vi.fn(), process: vi.fn() }));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/wa-agents/inboundRecovery', () => ({ processInboundRecovery: m.process }));
vi.mock('@/lib/wa-agents/internalAuth', () => ({ verifyInternalSecret: m.authorized }));

const message = { organization_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', message_id: '33333333-3333-4333-8333-333333333333' };
const request = (data: unknown) => new Request('https://crm.test/api/wa-agents/inbound-recovery', { method: 'POST', body: JSON.stringify(data) });
beforeEach(() => { vi.clearAllMocks(); m.authorized.mockReturnValue(true); });

it('recusa chamadas sem autorização e mensagens sem identificação completa', async () => {
  m.authorized.mockReturnValueOnce(false);
  expect((await POST(request(message))).status).toBe(401);
  expect((await POST(request({ message_id: message.message_id }))).status).toBe(400);
  expect((await POST(request({ ...message, job: 'inbound_recovery' }))).status).toBe(400);
  expect(m.after).not.toHaveBeenCalled();
});

it.each([message, { job: 'inbound_recovery' }])('aceita o aviso da entrada ou do relógio e processa após responder', async data => {
  expect((await POST(request(data))).status).toBe(202);
  expect(m.process).not.toHaveBeenCalled();
  await m.after.mock.calls[0][0]();
  expect(m.process).toHaveBeenCalledExactlyOnceWith({}, 'message_id' in data ? data : undefined);
});
