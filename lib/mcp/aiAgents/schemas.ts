import { z } from 'zod';
import { AgentInputSchema } from '@/lib/wa-agents/types';

const limit = z.number().int().min(1).max(100).default(30);
const version = z.number().int().min(0).max(2_147_483_647);
const timestamp = z.iso.datetime({ offset: true });
export const agentSchema = z.strictObject({ agentId: z.uuid() });
export const pageSchema = z.strictObject({ afterId: z.uuid().optional(), limit });
export const conversationsSchema = agentSchema.extend({
  ...pageSchema.shape, from: timestamp, to: timestamp,
}).refine(({ from, to }) => {
  const duration = Date.parse(to) - Date.parse(from);
  return duration > 0 && duration <= 7 * 24 * 60 * 60 * 1000;
}, 'Informe um período positivo de até sete dias.');
export const transcriptSchema = agentSchema.extend({
  conversationId: z.uuid(), limit,
  after: z.strictObject({ at: timestamp, id: z.uuid() }).optional(),
});
export const versionsSchema = agentSchema.extend({ beforeVersion: version.optional(), limit });
export const versionSchema = agentSchema.extend({ version });

const changeSchema = agentSchema.extend({
  expectedVersion: version,
  changeSummary: z.string().trim().min(1).max(2000),
  externalRef: z.string().trim().min(1).max(500).describe('Referência da tarefa e da aprovação do Board.'),
});
export const updateSchema = changeSchema.extend({
  // The form defaults missing fields to an empty string. A partial MCP update preserves them.
  system_prompt: AgentInputSchema.shape.system_prompt.removeDefault().optional(),
  stop_rules: AgentInputSchema.shape.stop_rules.removeDefault().optional(),
}).refine(input => input.system_prompt !== undefined || input.stop_rules !== undefined,
  'Informe system_prompt e/ou stop_rules.');
export const restoreSchema = changeSchema.extend({ version });
