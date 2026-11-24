import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const test = vi.hoisted(() => ({ after: vi.fn(), worker: vi.fn(), config: vi.fn() }));
vi.mock('next/server', () => ({ after: test.after }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/notifications/pushDispatch', () => ({ dispatchPendingPush: test.worker }));
vi.mock('@/lib/notifications/webPush', () => ({ readWebPushConfig: test.config }));
vi.mock('@/lib/whatsapp/api', () => ({ json: (value: unknown, status = 200) => Response.json(value, { status }) }));

function request(secret: string, job = 'web_push') {
  return new Request('https://crm.example.test/api/notifications/push/dispatch', {
    method: 'POST', headers: { 'x-internal-secret': secret }, body: JSON.stringify({ job }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WA_AGENTS_INTERNAL_SECRET', 'segredo-ficticio');
  test.config.mockReturnValue({ subject: 'mailto:fake@example.test' });
});
afterEach(() => vi.unstubAllEnvs());
it('não acorda o worker sem o segredo ou com outro tipo de tarefa', async () => {
  expect((await POST(request('incorreto'))).status).toBe(401);
  expect((await POST(request('segredo-ficticio', 'outra'))).status).toBe(400);
  expect(test.after).not.toHaveBeenCalled();
});
it('não consome a fila se a instalação ainda não tem as chaves', async () => {
  test.config.mockReturnValue(null);
  expect((await POST(request('segredo-ficticio'))).status).toBe(503);
  expect(test.after).not.toHaveBeenCalled();
});
it('confirma a solicitação interna e despacha depois com serviço simulado', async () => {
  expect((await POST(request('segredo-ficticio'))).status).toBe(202);
  expect(test.worker).not.toHaveBeenCalled();
  await test.after.mock.calls[0][0]();
  expect(test.worker).toHaveBeenCalledOnce();
});
