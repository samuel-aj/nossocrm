import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as accept } from './route';
import { POST as direct } from '../../admin/users/route';
import { POST as inviteByEmail } from '../../admin/invites/route';

const m = vi.hoisted(() => ({
  from: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), updateUserById: vi.fn(),
  createUser: vi.fn(), deleteUser: vi.fn(), find: vi.fn(), count: vi.fn(), mail: vi.fn(), sendInvite: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ from: m.from, auth: { admin: { ...m, inviteUserByEmail: m.sendInvite } } }),
  createClient: async () => ({ from: m.from, auth: { getUser: m.getUser, updateUser: m.updateUser } }),
}));
vi.mock('@/lib/supabase/authUsers', () => ({ findAuthUserByEmail: m.find }));
vi.mock('@/lib/supabase/orgMembers', () => ({ countOrgMembers: m.count }));
vi.mock('@/lib/permissions/teamAccessServer', () => ({ canManageTeam: async () => true }));
vi.mock('@/lib/supabase/tabOrgScope', () => ({ withTabOrg: (p: unknown) => p }));
vi.mock('@/lib/email/orgAddedEmail', () => ({ sendOrgAddedEmail: m.mail }));

const email = 'test@example.invalid';
const password = 'local-fixture-9!';
const req = (body: object) => new Request('https://crm.test', { method: 'POST', body: JSON.stringify(body) });
const submit = () => accept(req({ email, password, token: 'fixture-token' }));
let consumed = false, failLink = false, boundEmail: string | null = email, max = 1;
let profileOrg = 'org';
let inviteExpired = false;
let links: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  consumed = false; failLink = false; boundEmail = email; max = 1; profileOrg = 'org'; inviteExpired = false; links = [];
  m.find.mockResolvedValue({ id: 'u', email, invited_at: '2026-01-01', email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-01-01' });
  m.getUser.mockResolvedValue({ data: { user: { id: 'u', email } } });
  m.updateUser.mockResolvedValue({ error: null });
  m.updateUserById.mockResolvedValue({ error: null });
  m.createUser.mockResolvedValue({ data: { user: { id: 'new' } }, error: null });
  m.deleteUser.mockResolvedValue({ error: null }); m.count.mockResolvedValue(1);
  m.sendInvite.mockResolvedValue({ error: null });
  m.from.mockImplementation((table: string) => {
    let write: Record<string, unknown> | undefined, consumedBefore = false;
    const result = () => {
      if (table === 'organization_invites') return { data: consumedBefore ? null : { id: 'i', email: boundEmail, role: 'admin', organization_id: 'org', expires_at: inviteExpired ? '2000-01-01' : null } };
      if (table === 'profiles') return { data: { id: 'u', organization_id: profileOrg, role: 'admin' } };
      if (table === 'organizations') return { data: { max_users: max } };
      if (table === 'user_organizations' && write) { if (!failLink) links.push(write); return { error: failLink ? { message: 'write failed' } : null }; }
      return { data: null, error: null };
    };
    const q = {
      select: () => q, eq: () => q, is: () => q, insert: () => q,
      update: (v: Record<string, unknown>) => {
        if (table === 'organization_invites') { consumedBefore = consumed; consumed = v.used_at !== null; }
        return q;
      },
      upsert: (v: Record<string, unknown>) => { write = v; return q; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  });
});

describe('primeiro acesso', () => {
  it('aceita o convite depois da confirmação por e-mail, inclusive na última vaga; impede reutilização', async () => {
    expect((await submit()).status).toBe(200);
    expect(m.updateUser).toHaveBeenCalledWith({ password });
    expect(links).toEqual([{ user_id: 'u', organization_id: 'org', role: 'admin' }]);
    expect((await submit()).status).toBe(400);
    expect(m.updateUser).toHaveBeenCalledTimes(1);
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
  it.each(['sem sessão', 'outra pessoa', 'outra organização', 'link genérico', 'expirado'])('não altera senha: %s', async (mode) => {
    if (mode === 'sem sessão') m.getUser.mockResolvedValue({ data: { user: null } });
    if (mode === 'outra pessoa') m.getUser.mockResolvedValue({ data: { user: { id: 'outro', email } } });
    if (mode === 'outra organização') profileOrg = 'outra';
    if (mode === 'link genérico') boundEmail = null;
    if (mode === 'expirado') inviteExpired = true;
    expect((await submit()).ok).toBe(false);
    expect(consumed).toBe(false);
    expect(m.updateUser).not.toHaveBeenCalled(); expect(m.updateUserById).not.toHaveBeenCalled(); expect(links).toEqual([]);
  });
  it('não usa o token copiável como autorização de senha nem antes de confirmar a conta convidada', async () => {
    m.find.mockResolvedValue({ id: 'u', email, invited_at: '2026-01-01' });
    m.getUser.mockResolvedValue({ data: { user: null } });
    const res = await submit();
    expect(await res.json()).toMatchObject({ code: 'confirm_email' });
    expect(m.updateUserById).not.toHaveBeenCalled(); expect(m.updateUser).not.toHaveBeenCalled(); expect(consumed).toBe(false);
  });
  it('permite tentar novamente se o vínculo falhar, sem trocar senha nem excluir conta existente', async () => {
    failLink = true; expect((await submit()).status).toBe(503);
    expect(consumed).toBe(false); expect(m.deleteUser).not.toHaveBeenCalled(); expect(m.updateUser).not.toHaveBeenCalled();
    failLink = false; expect((await submit()).ok).toBe(true);
  });
  it('cria uma conta nova pelo link genérico e respeita o limite', async () => {
    m.find.mockResolvedValue(null); boundEmail = null;
    expect((await submit()).status).toBe(400); expect(m.createUser).not.toHaveBeenCalled();
    max = 2; expect((await submit()).ok).toBe(true);
    expect(m.createUser).toHaveBeenCalledWith(expect.objectContaining({ email, password }));
  });
  it('não afirma ter criado uma senha para um e-mail já cadastrado no Login pronto', async () => {
    max = 2; m.createUser.mockResolvedValue({ error: { code: 'email_exists', message: 'Already registered' } });
    const res = await direct(req({ email, password, role: 'admin' }));
    expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ code: 'existing_login' });
    expect(links).toEqual([]); expect(m.updateUserById).not.toHaveBeenCalled(); expect(m.mail).not.toHaveBeenCalled();
  });
  it('no Login pronto novo grava a senha informada antes de avisar a pessoa', async () => {
    max = 2; m.mail.mockResolvedValue(true);
    expect((await direct(req({ email, password, role: 'admin' }))).status).toBe(201);
    expect(m.createUser).toHaveBeenCalledWith(expect.objectContaining({ email, password, email_confirm: true }));
    expect(links).toEqual([{ user_id: 'new', organization_id: 'org', role: 'admin' }]); expect(m.mail).toHaveBeenCalled();
  });
  it('reenvia convite ainda não confirmado na última vaga sem apagar a conta original', async () => {
    m.find.mockResolvedValue({ id: 'u', email, invited_at: '2026-01-01' });
    const res = await inviteByEmail(req({ email, role: 'admin', sendEmail: true }));
    expect(res.status).toBe(201); expect(m.sendInvite).toHaveBeenCalledOnce(); expect(m.deleteUser).not.toHaveBeenCalled();
  });
});
