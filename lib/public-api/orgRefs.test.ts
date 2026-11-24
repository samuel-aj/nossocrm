import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: vi.fn() }));

import { quotePostgrestValue } from './orgRefs';

describe('quotePostgrestValue', () => {
  it('põe o valor entre aspas para vírgula e ponto não virarem filtro', () => {
    expect(quotePostgrestValue('x,id.not.is.null')).toBe('"x,id.not.is.null"');
  });

  it('escapa aspas e barra invertida', () => {
    expect(quotePostgrestValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
