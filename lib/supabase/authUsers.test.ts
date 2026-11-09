import { afterEach, expect, it, vi } from 'vitest';
import { findAuthUserByEmail } from './authUsers';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup(reply: Response) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'only-a-fixture');
  const http = vi.fn().mockResolvedValue(reply); vi.stubGlobal('fetch', http); return http;
}
it('filtra no Auth e só aceita o e-mail exato (inclusive alias +)', async () => {
  const http = setup(Response.json({ users: [{ id: 'outro', email: 'ax+qa@example.test' }, { id: 'ok', email: 'x+qa@example.test' }] }));
  expect((await findAuthUserByEmail(' X+QA@example.test '))?.id).toBe('ok');
  expect(http.mock.calls[0][0].searchParams.get('filter')).toBe('x+qa@example.test');
});
it('não confunde falha do diretório com e-mail disponível', async () => {
  setup(new Response(null, { status: 500 }));
  await expect(findAuthUserByEmail('x@example.test')).rejects.toThrow();
});
it('um resultado apenas parcial não identifica o titular', async () => {
  setup(Response.json({ users: [{ email: 'prefix-x@example.test' }] }));
  expect(await findAuthUserByEmail('x@example.test')).toBeNull();
});
