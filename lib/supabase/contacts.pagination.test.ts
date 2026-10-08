import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), organization: vi.fn() }));
vi.mock('./client', () => ({ supabase: { from: mocks.from } }));
vi.mock('./orgId', () => ({ getCurrentOrganizationId: mocks.organization, invalidateOrgCache: vi.fn() }));
import { contactsService } from './contacts';
import { queryKeys } from '@/lib/query/queryKeys';

const records = [
  { id: 'deleted', name: 'Contato excluído', deleted_at: '2026-10-07' },
  { id: 'first', name: 'João', deleted_at: null },
  { id: 'second', name: 'Cíntia', deleted_at: null },
];
function databaseQuery() {
  let rows = [...records];
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    is: vi.fn(function (this: unknown, column: string, value: null) {
      if (column === 'deleted_at') rows = rows.filter(row => row.deleted_at === value);
      return this;
    }),
    range: vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1), count: rows.length, error: null,
    })),
  };
}

describe('contact picker pagination', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.organization.mockResolvedValue('org'); });

  it('excludes deleted contacts before computing pages and counts', async () => {
    const query = databaseQuery();
    mocks.from.mockReturnValue(query);
    const result = await contactsService.getAllPaginated({ pageIndex: 0, pageSize: 1 }, { excludeDeleted: true });
    expect(query.select).toHaveBeenCalledWith('*', { count: 'exact' });
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.is.mock.invocationCallOrder[0]).toBeLessThan(query.range.mock.invocationCallOrder[0]);
    expect(result.error).toBeNull();
    expect(result.data?.data.map(contact => contact.id)).toEqual(['first']);
    expect(result.data).toMatchObject({ totalCount: 2, pageIndex: 0, pageSize: 1, hasMore: true });

    mocks.from.mockReturnValue(databaseQuery());
    const last = await contactsService.getAllPaginated({ pageIndex: 1, pageSize: 1 }, { excludeDeleted: true });
    expect(last.data?.data.map(contact => contact.id)).toEqual(['second']);
    expect(last.data).toMatchObject({ totalCount: 2, pageIndex: 1, hasMore: false });
  });

  it('preserves the existing behavior for consumers that do not opt in', async () => {
    const query = databaseQuery();
    mocks.from.mockReturnValue(query);
    const result = await contactsService.getAllPaginated({ pageIndex: 0, pageSize: 1 });
    expect(query.is).not.toHaveBeenCalled();
    expect(result.data?.data.map(contact => contact.id)).toEqual(['deleted']);
    expect(result.data?.totalCount).toBe(3);
  });

  it('keeps filtered picker results separate from cached general contact pages', () => {
    const page = { pageIndex: 0, pageSize: 10 };
    expect(queryKeys.contacts.paginated(page, { search: '' })).not.toEqual(
      queryKeys.contacts.paginated(page, { search: '', excludeDeleted: true }),
    );
  });
});
