import { z } from 'zod';

const ids = z.array(z.string().uuid()).max(500);
export const conversationLabelsPatch = z.union([
  z.object({ labelIds: ids }).strict(),
  z.object({ addLabelIds: ids.default([]), removeLabelIds: ids.default([]) }).strict()
    .refine(v => v.addLabelIds.length + v.removeLabelIds.length > 0, 'Nada para alterar'),
  z.object({ dealId: z.string().uuid().nullable() }).strict(),
]);

/** Direct array clients can contend with database fanout; retry only aborted transactions. */
export async function retryLabelWrite<T extends { error: { code?: string } | null }>(operation: () => PromiseLike<T>): Promise<T> {
  let result = await operation();
  for (let retry = 0; retry < 2 && ['40P01', '40001'].includes(result.error?.code ?? ''); retry++) {
    result = await operation();
  }
  return result;
}
