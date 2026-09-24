import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
    auth: vi.fn(), conn: vi.fn(), sendTemplate: vi.fn(), record: vi.fn(), signed: vi.fn(), row: null as Record<string, unknown> | null, media: null as Record<string, unknown> | null, filters: [] as Array<[
        string,
        unknown
    ]>
}));
vi.mock('@/lib/whatsapp/api', () => ({
    requireOrgUser: h.auth, json: (b: unknown, s = 200) => Response.json(b, { status: s })
}));
vi.mock('@/lib/permissions/server', () => ({
    connectionAllowed: () => true, getVisibilityRules: async () => null
}));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: async () => true }));
vi.mock('@/lib/whatsapp/service', () => ({
    getConnectionByOrg: h.conn, getConnectionByIdForOrg: h.conn, ensureConversation: async () => ({ id: 'conv' }), getGroupConversation: vi.fn(), getWaGroupsEnabled: async () => false, getQuotableMessage: vi.fn(), recordOutboundMessage: h.record, replicateOutboundToSiblings: vi.fn()
}));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendTemplate: h.sendTemplate }) }));
import { POST } from './route';
const req = () => new Request('https://crm.test/api/whatsapp/send', {
    method: 'POST', headers: {
        host: 'crm.test', origin: 'https://crm.test', 'content-type': 'application/json'
    }, body: JSON.stringify({
        to: '+5511999999999', text: 'Olá Maria', connectionId: 'conn', template: {
            name: 'media', language: 'pt_BR', params: ['Maria']
        }
    })
});
beforeEach(() => {
    vi.clearAllMocks();
    h.filters = [];
    h.row = {
        header_type: 'image', media_id: 'asset', meta_status: 'APPROVED'
    };
    h.media = {
        id: 'asset', storage_path: 'org/conn/asset/photo.png', header_type: 'image', mime_type: 'image/png', byte_size: 8, verified_at: 'now'
    };
    h.conn.mockResolvedValue({
        id: 'conn', status: 'connected'
    });
    h.sendTemplate.mockResolvedValue({
        ok: true, providerMessageId: 'message'
    });
    h.record.mockResolvedValue({ body: 'Olá Maria' });
    h.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.test/fresh' } });
    h.auth.mockResolvedValue({
        ok: true, user: {
            id: 'user', organizationId: 'org'
        }, admin: {
            from: (table: string) => {
                const q = {
                    select: () => q, eq: (k: string, v: unknown) => {
                        h.filters.push([k, v]);
                        return q;
                    }, maybeSingle: async () => ({ data: table === 'message_templates' ? h.row : h.media })
                };
                return q;
            }, storage: { from: () => ({ createSignedUrl: h.signed }) }
        }
    });
});
it('chat uses the same header/body shape as bot with a fresh private URL', async () => {
    expect((await POST(req())).status).toBe(200);
    expect(h.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'media', components: [{
                type: 'header', parameters: [{
                        type: 'image', image: { link: 'https://storage.test/fresh' }
                    }]
            }, {
                type: 'body', parameters: [{
                        type: 'text', text: 'Maria'
                    }]
            }]
    }));
    expect(h.filters).toContainEqual(['organization_id', 'org']);
    expect(h.filters).toContainEqual(['connection_id', 'conn']);
});
it('blocks imported template with missing media before sending', async () => {
    h.row!.media_id = null;
    expect((await POST(req())).status).toBe(422);
    expect(h.sendTemplate).not.toHaveBeenCalled();
});
it('blocks another tenant media before signing or sending', async () => {
    h.media = null;
    expect((await POST(req())).status).toBe(422);
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.signed).not.toHaveBeenCalled();
});
it('keeps text-only payload unchanged', async () => {
    h.row = { meta_status: 'APPROVED' };
    expect((await POST(req())).status).toBe(200);
    expect(h.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ components: [{
                type: 'body', parameters: [{
                        type: 'text', text: 'Maria'
                    }]
            }] }));
    expect(h.signed).not.toHaveBeenCalled();
});
