import { describe, expect, it, vi } from 'vitest';
import { conversationLabelsPatch, retryLabelWrite } from './conversationLabels';
const id = '11111111-1111-4111-8111-111111111111';
describe('conversation label mutation contracts', () => {
  it('accepts legacy replacement, atomic delta and explicit unlink', () => {
    expect(conversationLabelsPatch.parse({ labelIds: [] })).toEqual({ labelIds: [] });
    expect(conversationLabelsPatch.parse({ removeLabelIds: [id] })).toEqual({ removeLabelIds: [id], addLabelIds: [] });
    expect(conversationLabelsPatch.parse({ dealId: null })).toEqual({ dealId: null });
  });
  it('rejects malformed IDs, empty payloads and ambiguous mixed semantics', () => {
    for (const body of [null, {}, { labelIds: ['bad'] }, { labelIds: [], dealId: id }, { addLabelIds: [id], labelIds: [] }]) {
      expect(conversationLabelsPatch.safeParse(body).success).toBe(false);
    }
  });
  it('retries only transaction aborts, at most twice', async () => {
    const operation = vi.fn().mockResolvedValueOnce({ error: { code: '40P01' } }).mockResolvedValueOnce({ error: { code: '40001' } }).mockResolvedValue({ error: null, data: 'ok' });
    expect(await retryLabelWrite(operation)).toEqual({ error: null, data: 'ok' });
    expect(operation).toHaveBeenCalledTimes(3);
    const invalid = vi.fn().mockResolvedValue({ error: { code: '23514' } });
    await retryLabelWrite(invalid);
    expect(invalid).toHaveBeenCalledTimes(1);
  });
});
