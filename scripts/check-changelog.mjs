#!/usr/bin/env node
/**
 * Confere se uma publicação veio com a sua entrada no CHANGELOG.md.
 *
 * Roda no GitHub (verificação "Registro de alterações") a cada PR para a main
 * e a cada push na main, e também à mão:
 *
 *   node scripts/check-changelog.mjs                 compara a branch atual com origin/main
 *   BASE=<sha> HEAD=<sha> node scripts/check-changelog.mjs
 *
 * Passa quando: o CHANGELOG.md foi alterado, OU a mudança é só de documentação
 * e testes, OU o título traz [sem-changelog].
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Arquivos que não mudam o que está em produção e por isso dispensam registro. */
const EXEMPT = [
  /^docs\//,
  /^test\//,
  /^\.github\//,
  /\.md$/i,
  /\.test\.tsx?$/,
  /^vitest\.[^/]*config\.ts$/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
];

export function evaluate(files, title = '') {
  const changed = files.map(f => f.trim().replace(/\\/g, '/')).filter(Boolean);
  if (changed.includes('CHANGELOG.md')) return { ok: true, reason: 'CHANGELOG.md atualizado.' };
  const relevant = changed.filter(f => !EXEMPT.some(rule => rule.test(f)));
  if (relevant.length === 0) return { ok: true, reason: 'Só documentação e testes: não precisa de registro.' };
  if (/\[sem-changelog\]/i.test(title)) return { ok: true, reason: 'Dispensado por [sem-changelog] no título.' };
  return { ok: false, reason: 'Publicação sem registro no CHANGELOG.md.', relevant };
}

function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const head = process.env.HEAD || 'HEAD';
  let base = process.env.BASE || '';
  if (!base) {
    git('fetch', 'origin', 'main', '--quiet');
    base = 'origin/main';
  }
  if (/^0+$/.test(base)) {
    console.log('Sem commit anterior para comparar: nada a conferir.');
    return 0;
  }

  const files = git('diff', '--name-only', `${base}...${head}`).split('\n');
  const result = evaluate(files, process.env.TITLE || '');
  if (result.ok) {
    console.log(`OK: ${result.reason}`);
    return 0;
  }

  console.error(
    [
      result.reason,
      '',
      'Esta publicação muda o que está em produção e não trouxe a entrada no CHANGELOG.md.',
      'Acrescente a entrada (o modelo está no topo do arquivo) no mesmo PR ou num commit em seguida.',
      'Para dispensar de propósito, escreva [sem-changelog] no título do PR ou do commit.',
      '',
      `Arquivos que pedem registro (${result.relevant.length}):`,
      ...result.relevant.slice(0, 20).map(f => `  ${f}`),
      result.relevant.length > 20 ? `  ... e mais ${result.relevant.length - 20}` : '',
    ].join('\n'),
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
