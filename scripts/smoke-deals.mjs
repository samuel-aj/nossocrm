#!/usr/bin/env node
/**
 * Smoke test do endpoint público de deals (NossoCRM).
 *
 * Roda o caminho completo que o n8n usa em produção:
 *   1. GET  /api/public/v1/me                    → confirma que a API key é válida
 *   2. POST /api/public/v1/deals (board_key)     → cria deal de teste
 *   3. POST /api/public/v1/deals (external_id)   → confirma idempotência (mesma chamada não duplica)
 *
 * Uso:
 *   NOSSOCRM_URL=https://nossocrm-tau.vercel.app \
 *   NOSSOCRM_API_KEY=ncrm_xxxxxxxxxxxx \
 *   node scripts/smoke-deals.mjs
 *
 * Opcional:
 *   BOARD_KEY=pipeline-de-vendas (default)
 */

const URL_BASE = (process.env.NOSSOCRM_URL || '').replace(/\/$/, '');
const API_KEY = process.env.NOSSOCRM_API_KEY || '';
const BOARD_KEY = process.env.BOARD_KEY || 'pipeline-de-vendas';

if (!URL_BASE) {
  console.error('✗ NOSSOCRM_URL não definida.');
  process.exit(1);
}
if (!API_KEY) {
  console.error('✗ NOSSOCRM_API_KEY não definida.');
  process.exit(1);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Api-Key': API_KEY,
};

function log(symbol, label, detail) {
  const line = detail ? `${symbol} ${label} — ${detail}` : `${symbol} ${label}`;
  console.log(line);
}

async function step(label, fn) {
  process.stdout.write(`… ${label}\n`);
  try {
    const result = await fn();
    log('✓', label, result?.summary || '');
    return result;
  } catch (err) {
    log('✗', label, err?.message || String(err));
    process.exit(2);
  }
}

async function check(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { res, json, text };
}

async function main() {
  console.log(`Smoke test → ${URL_BASE}\n`);

  await step('Autenticação (GET /me)', async () => {
    const { res, json, text } = await check(`${URL_BASE}/api/public/v1/me`, { headers: HEADERS });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { summary: `org=${json?.organization?.name || json?.organization_id || 'ok'}` };
  });

  const externalId = `smoke-${Date.now()}`;
  const dealPayload = {
    title: `Smoke test ${new Date().toISOString()}`,
    value: 0,
    board_key: BOARD_KEY,
    external_id: externalId,
    contact: {
      name: 'Smoke Test',
      email: `smoke+${Date.now()}@example.com`,
      phone: `+5511${String(Date.now()).slice(-9)}`,
    },
  };

  const firstId = await step(`Criar deal (board_key="${BOARD_KEY}")`, async () => {
    const { res, json, text } = await check(`${URL_BASE}/api/public/v1/deals`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(dealPayload),
    });
    if (res.status !== 201) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (json?.action !== 'created') throw new Error(`expected action='created', got '${json?.action}'`);
    if (!json?.data?.id) throw new Error('resposta sem data.id');
    return { id: json.data.id, summary: `id=${json.data.id.slice(0, 8)}… action=${json.action}` };
  });

  await step('Idempotência (repetir mesmo external_id)', async () => {
    const { res, json, text } = await check(`${URL_BASE}/api/public/v1/deals`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(dealPayload),
    });
    if (res.status !== 200) throw new Error(`esperado 200 (idempotente), recebido ${res.status}: ${text.slice(0, 200)}`);
    if (json?.action !== 'existing') throw new Error(`esperado action='existing', recebido '${json?.action}'`);
    if (json?.data?.id !== firstId.id) throw new Error(`id divergente: esperado ${firstId.id}, recebido ${json?.data?.id}`);
    return { summary: `id=${json.data.id.slice(0, 8)}… action=existing` };
  });

  console.log(`\n✓ Smoke test OK. Deal criado: ${firstId.id}`);
  console.log(`  Para limpar: DELETE /api/public/v1/deals/${firstId.id} (se o endpoint existir) ou apague manualmente.`);
}

main().catch((err) => {
  console.error(`\n✗ Erro inesperado: ${err?.message || err}`);
  process.exit(3);
});
