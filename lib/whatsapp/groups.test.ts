import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetaGroup } from './groups';
import type { WaConnectionRow } from './service';

const conn = { provider: 'meta_cloud', instance_token: 'fake-token', meta_phone_number_id: 'fake-number' } as WaConnectionRow;
const eligibility = 'Groups APIs are only available for eligible phone numbers. Please check eligibility for Groups APIs in our documentation';
afterEach(() => vi.unstubAllGlobals());

describe('Meta group creation errors', () => {
  it.each([
    { message: eligibility, code: 100 },
    { message: 'Invalid parameter', code: 100, error_data: { details: eligibility } },
    { message: eligibility, error_data: { details: 'See documentation' } },
  ])('identifies the eligibility refusal and explains it in Portuguese', async error => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error }, { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await createMetaGroup(conn, { subject: 'Grupo de demonstração' })).toMatchObject({
      ok: false, code: 'GROUPS_NOT_ELIGIBLE', error: expect.stringContaining('não está habilitado'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not misclassify unrelated parameter or authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'Invalid OAuth access token.', code: 190 } }, { status: 401 })));
    expect(await createMetaGroup(conn, { subject: 'Demonstração' })).toEqual({ ok: false, error: 'Invalid OAuth access token.' });
  });

  it('preserves successful creation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'group-demo' })));
    expect(await createMetaGroup(conn, { subject: 'Demonstração' })).toEqual({ ok: true, groupId: 'group-demo' });
  });
});
