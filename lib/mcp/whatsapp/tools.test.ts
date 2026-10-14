import { expect, it } from 'vitest';
import { addWhatsAppTools } from './tools';
import type { WhatsAppContext } from './access';

it('accepts the PostgreSQL timestamp offset in the returned message cursor and rejects filter injection', () => {
  const registry = addWhatsAppTools({ tools: [], toolByMcpName: {}, internalKeyByMcpName: {}, mcpNameByInternalKey: {} }, {} as WhatsAppContext);
  const schema = registry.toolByMcpName['crm.whatsapp.messages.list'].inputSchema as { safeParse: (value: unknown) => { success: boolean } };
  const id = '00000000-0000-4000-8000-000000000001';
  const args = { conversationId: id, connectionId: id, before: { at: '2026-10-14T12:01:00.123456+00:00', id } };
  expect(schema.safeParse(args).success).toBe(true);
  expect(schema.safeParse({ ...args, before: { ...args.before, at: '2026-10-14T12:01:00Z,organization_id.eq.other' } }).success).toBe(false);
});
