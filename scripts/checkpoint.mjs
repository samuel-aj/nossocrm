#!/usr/bin/env node
/**
 * Marca a versão que está em produção AGORA como ponto de restauração, antes
 * de publicar algo novo. Cria a etiqueta `prod-pre-<nome>` no commit atual da
 * main do GitHub e envia para lá.
 *
 *   npm run checkpoint -- pagamentos        cria e envia prod-pre-pagamentos
 *   npm run checkpoint -- pagamentos --dry  só mostra o que faria
 *   npm run checkpoint -- --list            lista os pontos existentes
 *
 * Como voltar a um ponto: docs/restauracao.md
 */
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const dry = args.includes('--dry');

git('fetch', 'origin', '--quiet');

if (args.includes('--list')) {
  const lines = git(
    'for-each-ref',
    '--sort=-creatordate',
    // etiqueta anotada: mostra o commit para onde ela aponta, não o id da própria etiqueta
    '--format=%(creatordate:short)  %(if)%(*objectname)%(then)%(*objectname:short)%(else)%(objectname:short)%(end)  %(refname:short)',
    'refs/tags/prod-pre-*',
  );
  console.log(lines || 'Nenhum ponto de restauração ainda.');
  process.exit(0);
}

const name = (args.find(a => !a.startsWith('--')) || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

if (!name) {
  console.error('Uso: npm run checkpoint -- <nome-curto>   (ex.: npm run checkpoint -- pagamentos)');
  process.exit(1);
}

const tag = `prod-pre-${name}`;
const sha = git('rev-parse', 'origin/main');
const remote = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`);

if (git('tag', '-l', tag) || remote) {
  console.error(`O ponto ${tag} já existe. Escolha outro nome (ex.: ${tag}-2).`);
  process.exit(1);
}

console.log(`${dry ? '[simulação] ' : ''}Ponto de restauração ${tag} -> ${sha.slice(0, 8)} (produção de agora)`);
if (dry) process.exit(0);

git('tag', '-a', tag, sha, '-m', `Produção antes de: ${name}`);
git('push', 'origin', tag);

console.log(`Enviado ao GitHub. Para voltar a esta versão, siga docs/restauracao.md.`);

// Lembrete do registro de alterações: a branch que vai ser publicada já traz a entrada?
try {
  const changed = git('diff', '--name-only', 'origin/main...HEAD').split(/\r?\n/);
  if (changed.filter(Boolean).length && !changed.includes('CHANGELOG.md')) {
    console.log('Atenção: esta branch ainda não tem entrada no CHANGELOG.md. Confira com: npm run changelog:check');
  }
} catch {
  // sem branch local para comparar: segue sem o lembrete
}
