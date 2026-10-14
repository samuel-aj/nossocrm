import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { buildCrmMcpRegistry } from '@/lib/mcp/crmRegistry';
import { zodToJsonSchema2020 } from '@/lib/mcp/zodToJsonSchema';
import { resolveMcpOwner } from '@/lib/mcp/whatsapp/access';
import { addWhatsAppTools } from '@/lib/mcp/whatsapp/tools';

export const runtime = 'nodejs';
export const maxDuration = 60;
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
};

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function getApiKeyFromHeaders(request: Request) {
  const headerKey = request.headers.get('x-api-key');
  if (headerKey?.trim()) return headerKey.trim();

  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]?.trim()) return m[1].trim();

  return '';
}

async function authMcp(request: Request) {
  const apiKey = getApiKeyFromHeaders(request);
  if (!apiKey) return { ok: false as const, status: 401, body: { error: 'Missing API key', code: 'AUTH_MISSING' } };

  // `authPublicApi` expects X-Api-Key. Most MCP clients use Authorization: Bearer, so we normalize here.
  const headers = new Headers(request.headers);
  headers.set('x-api-key', apiKey);
  const normalized = new Request(request.url, { method: request.method, headers });

  return await authPublicApi(normalized);
}

function toToolResult(payload: unknown, opts?: { isError?: boolean }) {
  const isError = !!opts?.isError || (payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in (payload as any));
  const text = JSON.stringify(payload, null, 2);

  // MCP guidance: when returning structuredContent, also include serialized JSON in a text block.
  const structuredContent =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;

  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
    isError,
  };
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
export const DELETE = GET;

async function readRpcBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
  finally { await reader.cancel().catch(() => undefined); }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  const protocol = request.headers.get('mcp-protocol-version');
  if (protocol && !PROTOCOLS.includes(protocol)) return NextResponse.json(jsonRpcError(null, -32600, 'Unsupported protocol version'), { status: 400 });
  if (!request.headers.get('content-type')?.includes('application/json')) return new NextResponse(null, { status: 415 });
  const auth = await authMcp(request);
  if (!auth.ok) {
    // JSON-RPC friendly error envelope (MCP clients will still see 401 if they surface it)
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: auth.body.error, data: auth.body } }, { status: auth.status });
  }

  const body = (await readRpcBody(request)) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || (body.id !== undefined && typeof body.id !== 'string' && typeof body.id !== 'number')) {
    return NextResponse.json(jsonRpcError(null, -32600, 'Invalid Request'), { status: 400 });
  }

  const admin = createStaticAdminClient();
  const user = await resolveMcpOwner(admin, auth.apiKeyId, auth.organizationId);
  if (!user) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32001, message: 'Invalid API key owner', data: { code: 'AUTH_OWNER_INVALID' } } },
      { status: 401 }
    );
  }

  // Minimal context for MCP execution. Tool args can still include boardId/dealId/etc.
  const registry = addWhatsAppTools(buildCrmMcpRegistry({
    context: { organizationId: auth.organizationId },
    userId: user.id,
  }), { admin, user, apiKeyId: auth.apiKeyId });

  if (body.id === undefined) return new NextResponse(null, { status: 202 });
  if (body.method === 'ping') return NextResponse.json(jsonRpcResult(body.id, {}));

  // MCP core methods
  if (body.method === 'initialize') {
    return NextResponse.json(
      jsonRpcResult(body.id, {
        protocolVersion: PROTOCOLS.includes(body.params?.protocolVersion) ? body.params.protocolVersion : PROTOCOLS[0],
        serverInfo: { name: 'crmia-next-mcp', version: '0.2.0' },
        capabilities: { tools: { listChanged: false } },
      })
    );
  }

  if (body.method === 'tools/list') {
    const tools = registry.tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: zodToJsonSchema2020(t.inputSchemaZod),
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }));

    return NextResponse.json(jsonRpcResult(body.id, { tools }));
  }

  if (body.method === 'tools/call') {
    const toolName = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (typeof toolName !== 'string' || !toolName) {
      return NextResponse.json(jsonRpcError(body.id, -32602, 'Invalid params: missing tool name'), { status: 400 });
    }

    const tool = registry.toolByMcpName[toolName];
    if (!tool) {
      return NextResponse.json(jsonRpcError(body.id, -32602, `Unknown tool: ${toolName}`), { status: 400 });
    }

    // Validate inputs using the underlying Zod schema when available.
    const schema: any = (tool as any).inputSchema;
    if (schema && typeof schema.safeParse === 'function') {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const msg = parsed.error?.issues?.map((i: any) => i?.message).filter(Boolean).join('; ') || 'Invalid tool arguments';
        return NextResponse.json(jsonRpcResult(body.id, toToolResult({ error: msg }, { isError: true })));
      }

      try {
        const out = await (tool as any).execute(parsed.data);
        return NextResponse.json(jsonRpcResult(body.id, toToolResult(out)));
      } catch (e: any) {
        return NextResponse.json(jsonRpcResult(body.id, toToolResult({ error: e?.message || 'Tool execution failed' }, { isError: true })));
      }
    }

    // No schema: best-effort execute.
    try {
      const out = await (tool as any).execute(args);
      return NextResponse.json(jsonRpcResult(body.id, toToolResult(out)));
    } catch (e: any) {
      return NextResponse.json(jsonRpcResult(body.id, toToolResult({ error: e?.message || 'Tool execution failed' }, { isError: true })));
    }
  }

  return NextResponse.json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`), { status: 200 });
}

