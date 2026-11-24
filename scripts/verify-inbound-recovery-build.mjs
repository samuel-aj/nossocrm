import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const serverDir = '.next/server';
const route = '/api/wa-agents/inbound-recovery/route';
const expectedFile = 'app/api/wa-agents/inbound-recovery/route.js';
const manifest = JSON.parse(readFileSync(join(serverDir, 'app-paths-manifest.json'), 'utf8'));

if (manifest[route] !== expectedFile) {
  throw new Error('A rota de recuperação de mensagens recebidas está ausente do manifesto do build.');
}

const handler = statSync(join(serverDir, expectedFile), { throwIfNoEntry: false });
if (!handler?.isFile() || handler.size === 0) {
  throw new Error('O build está sem o arquivo da rota de recuperação de mensagens recebidas.');
}

console.log('Rota de recuperação de mensagens recebidas verificada no build.');
