// Teste sem dependências: node scripts/check-changelog.selftest.mjs
// (o nome não termina em .test para o vitest não tentar rodar este arquivo)
import assert from 'node:assert/strict';
import { evaluate } from './check-changelog.mjs';

// código sem registro: reprova e lista o que pede registro
const r = evaluate(['app/api/x/route.ts', 'docs/a.md', 'lib/a.test.ts']);
assert.equal(r.ok, false);
assert.deepEqual(r.relevant, ['app/api/x/route.ts']);

// com o CHANGELOG no mesmo pacote: passa
assert.equal(evaluate(['app/api/x/route.ts', 'CHANGELOG.md']).ok, true);

// só documentação, testes e configuração de teste: passa sem registro
assert.equal(evaluate(['docs/a.md', 'README.md', 'lib/a.test.ts', 'features/b.test.tsx', 'vitest.security.config.ts', '.github/workflows/x.yml']).ok, true);

// migração de banco pede registro
assert.equal(evaluate(['supabase/migrations/20270101000000_x.sql']).ok, false);

// dispensa explícita no título
assert.equal(evaluate(['app/page.tsx'], 'ajuste de espaçamento [sem-changelog]').ok, true);
assert.equal(evaluate(['app/page.tsx'], 'ajuste de espaçamento').ok, false);

// nada alterado e caminhos do Windows
assert.equal(evaluate(['', ' ']).ok, true);
assert.equal(evaluate(['docs\\a.md']).ok, true);

console.log('check-changelog: 8 verificações ok');
