import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ guard: vi.fn(), visible: vi.fn(), load: vi.fn(), filters: [] as unknown[][] }));
vi.mock('@/app/api/wa-agents/_shared', () => ({
  guardRoute: h.guard,
  readJsonBody: (req: Request) => req.json(),
  validationError: () => Response.json({ error: 'invalid' }, { status: 400 }),
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));
vi.mock('@/lib/whatsapp/api', () => ({ json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => {
  const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: h.visible }; return q;
} }) }));
vi.mock('@/lib/zapsign/signatures', () => ({ DEAL_FILES_BUCKET: 'deal-files', loadZapSignSettings: h.load, discardSignature: vi.fn(), recoverManualPackage: vi.fn() }));
vi.mock('@/lib/permissions/teamAccessServer', () => ({ getTeamAccess: vi.fn(), visibleLead: vi.fn() }));
import { GET } from './route';

const autoLeadDealId = 'a1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d';
const signatures = {
  select: () => signatures, eq: (...args: unknown[]) => { h.filters.push(args); return signatures; },
  order: () => signatures, limit: async () => ({ data: [], error: null }),
};
const open = (dealId: string) => GET(new Request('https://crm.example.test/api/integrations/zapsign/deal/' + dealId), { params: Promise.resolve({ dealId }) });

beforeEach(() => {
  vi.clearAllMocks(); h.filters.length = 0;
  h.guard.mockResolvedValue({ ok: true, admin: { from: () => signatures }, user: { id: 'user-a', organizationId: 'org-a' } });
  h.visible.mockResolvedValue({ data: { id: autoLeadDealId, board_id: 'board', owner_id: null }, error: null });
  h.load.mockResolvedValue(null);
});

describe('aba Contrato do lead', () => {
  it('lista os contratos de um lead criado pelo lead automático do WhatsApp, cujo id é UUID versão 8', async () => {
    const res = await open(autoLeadDealId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: false, signatures: [] });
    expect(h.filters).toContainEqual(['deal_id', autoLeadDealId]);
  });
  it('recusa o que não é UUID antes de consultar o banco', async () => {
    const res = await open('nao-e-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ID inválido' });
    expect(h.visible).not.toHaveBeenCalled();
  });
});
