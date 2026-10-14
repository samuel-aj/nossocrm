import { createCRMTools } from '@/lib/ai/tools';
import type { CRMCallOptions } from '@/types/ai';
import { getCrmCatalogEntry, type CrmToolCatalogEntry } from './crmToolCatalog';

type AnyTool = {
  description?: string;
  // Zod schema passed to `tool({ inputSchema })`
  inputSchema?: unknown;
  // Vercel AI SDK tool execute
  execute?: (args: any) => Promise<any> | any;
  // Optional flag used by UI flows; irrelevant for MCP but useful metadata
  needsApproval?: boolean;
};

export type McpToolDraft = {
  /** MCP tool name (stable identifier). */
  name: string;
  /** UI-friendly name. */
  title: string;
  /** Human readable description. */
  description: string;
  /** Internal tool key in `createCRMTools` (useful for debugging/telemetry). */
  internalKey: string;
  /** Zod schema (to be converted to JSON Schema by the MCP adapter). */
  inputSchemaZod: unknown;
  /** Whether the underlying tool was marked as requiring approval in the product UI. */
  needsApproval: boolean;
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
};

export type CrmMcpRegistry = {
  /** Tool list (for `tools/list`), before Zod->JSON Schema conversion. */
  tools: McpToolDraft[];
  /** Fast lookup for `tools/call`: MCP tool name -> underlying tool object. */
  toolByMcpName: Record<string, AnyTool>;
  /** Fast lookup: MCP tool name -> internal key. */
  internalKeyByMcpName: Record<string, string>;
  /** Fast lookup: internal key -> MCP tool name. */
  mcpNameByInternalKey: Record<string, string>;
};

/**
 * Builds a registry that exposes the CRM AI tools (`createCRMTools`) as MCP tools.
 *
 * This is intentionally a pure “adapter” layer:
 * - No HTTP / JSON-RPC logic.
 * - No auth logic.
 * - No Zod->JSON Schema conversion (done elsewhere).
 */
export function buildCrmMcpRegistry(params: {
  context: CRMCallOptions;
  userId: string;
}): CrmMcpRegistry {
  const internalTools = createCRMTools(params.context, params.userId) as Record<string, AnyTool>;
  const internalKeys = Object.keys(internalTools);

  const tools: McpToolDraft[] = [];
  const toolByMcpName: Record<string, AnyTool> = {};
  const internalKeyByMcpName: Record<string, string> = {};
  const mcpNameByInternalKey: Record<string, string> = {};

  for (const internalKey of internalKeys) {
    const t = internalTools[internalKey];
    if (!t) continue;

    const catalog: CrmToolCatalogEntry | undefined = getCrmCatalogEntry(internalKey);

    // Fallback policy for “new/unmapped” tools:
    // never crash registry building; expose the tool with a safe, clearly-unmapped name.
    const name = catalog?.name ?? `crm.unmapped.${internalKey}`;
    const title = catalog?.title ?? internalKey;
    const description =
      catalog?.description ??
      (typeof t.description === 'string' && t.description.trim()
        ? t.description.trim()
        : 'Unmapped tool. This tool is available but has not been curated in the MCP catalog yet.');

    const inputSchemaZod = (t as any).inputSchema ?? {};
    const needsApproval = !!(t as any).needsApproval;

    tools.push({
      name,
      title,
      description,
      internalKey,
      inputSchemaZod,
      needsApproval,
    });

    toolByMcpName[name] = t;
    internalKeyByMcpName[name] = internalKey;
    mcpNameByInternalKey[internalKey] = name;
  }

  // Deterministic ordering improves diffing and caching in MCP clients.
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return { tools, toolByMcpName, internalKeyByMcpName, mcpNameByInternalKey };
}

