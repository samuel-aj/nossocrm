// Transfers local bytes through the CRM's authenticated MCP upload flow. Never sends a WhatsApp message.
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function uploadPdf({ filePath, conversationId, connectionId, endpoint, apiKey, storageOrigin }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('HTTPS_REQUIRED');
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 8 || info.size > 10 * 1024 * 1024 || !/\.pdf$/i.test(filePath)) throw new Error('INVALID_PDF');
  const bytes = await readFile(filePath);
  if (bytes.length !== info.size || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('INVALID_PDF');
  const client = new Client({ name: 'nossocrm-pdf-uploader', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error' } });
  const call = async (name, args) => {
    const result = await client.callTool({ name: `crm.whatsapp.uploads.${name}`, arguments: args });
    if (result.isError) throw new Error('MCP_UPLOAD_FAILED');
    return result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text);
  };
  try {
    await client.connect(transport);
    const prepared = await call('prepare', { conversationId, connectionId, fileName: basename(filePath), mimeType: 'application/pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const uploadUrl = new URL(prepared.uploadUrl);
    if (uploadUrl.protocol !== 'https:' || (storageOrigin ? uploadUrl.origin !== new URL(storageOrigin).origin : !uploadUrl.hostname.endsWith('.supabase.co'))) throw new Error('UNEXPECTED_STORAGE_ORIGIN');
    const response = await fetch(uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('STORAGE_UPLOAD_FAILED');
    return await call('complete', { attachmentId: prepared.attachmentId });
  } finally { await client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, conversationId, connectionId] = process.argv.slice(2);
  if (!filePath || !conversationId || !connectionId || !process.env.NOSSOCRM_API_KEY) {
    console.error('Uso: node scripts/mcp-upload-pdf.mjs <arquivo.pdf> <conversationId> <connectionId>. Defina NOSSOCRM_API_KEY.');
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await uploadPdf({ filePath, conversationId, connectionId, endpoint: process.env.NOSSOCRM_MCP_URL || 'https://crm.anunciojuridico.com.br/api/mcp', apiKey: process.env.NOSSOCRM_API_KEY, storageOrigin: process.env.NOSSOCRM_STORAGE_ORIGIN }), null, 2));
    } catch {
      // Do not log SDK/fetch exceptions: a signed URL or header can be embedded in them.
      console.error('Upload não concluído. Nenhuma mensagem foi enviada. Confira arquivo, IDs, acesso e configuração do MCP.');
      process.exitCode = 1;
    }
  }
}
