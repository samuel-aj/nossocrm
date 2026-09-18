import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotStep } from './types';
import { botTemplateConnectionError, templateFitsConnections } from './templateConnections';

const api = { id: 'template', name: 'Boas-vindas', type: 'whatsapp_api', connection_id: 'number-a', meta_status: 'APPROVED' };
const steps = [{ type: 'send_template', template_id: 'template' }] as BotStep[];

describe('modelos exclusivos por número', () => {
  it.each([{ ids: [] }, { ids: ['number-b'] }, { ids: ['number-a', 'number-b'] }])('bloqueia API em $ids', ({ ids }) => {
    expect(templateFitsConnections(api, ids)).toBe(false);
  });
  it('aceita somente o número do modelo e permite gerais em vários números', () => {
    expect(templateFitsConnections(api, ['number-a'])).toBe(true);
    expect(templateFitsConnections({ type: 'general' }, ['number-a', 'number-b'])).toBe(true);
    expect(templateFitsConnections({ type: 'whatsapp_api' }, ['number-a'])).toBe(false);
  });
  it('consulta modelos da organização ao validar ativação', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn().mockResolvedValue({ data: [api], error: null }) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const admin = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient;
    expect(await botTemplateConnectionError(admin, 'org', steps, ['number-a', 'number-b'])).toContain('apenas esse número');
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org');
    expect(await botTemplateConnectionError(admin, 'org', steps, ['number-a'])).toBeNull();
    query.in.mockResolvedValue({ data: [], error: null });
    expect(await botTemplateConnectionError(admin, 'org', steps, ['number-a'])).toContain('não existe');
    query.in.mockResolvedValue({ data: [{ ...api, meta_status: 'REJECTED' }], error: null });
    expect(await botTemplateConnectionError(admin, 'org', steps, ['number-a'])).toContain('aprovado');
  });
});
