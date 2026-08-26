/**
 * Diferença simples entre dois roteiros, linha a linha (LCS), para mostrar
 * o que a IA mudou antes de substituir o texto.
 *
 * CLIENT-SAFE: só funções puras.
 */

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

export type PromptDiff = {
  ops: DiffOp[];
  /** Linhas adicionadas */
  added: number;
  /** Linhas removidas */
  removed: number;
  before: { lines: number; chars: number };
  after: { lines: number; chars: number };
  /** true quando o texto é grande demais para o LCS e o diff virou só "removidas + adicionadas" */
  approximate: boolean;
};

/** Quebra o texto em linhas (normaliza \r\n). Texto vazio vira lista vazia. */
export function toLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized === '' ? [] : normalized.split('\n');
}

/** Limite de células da tabela do LCS (linhas antes x linhas depois) antes de cair no modo aproximado. */
const MAX_CELLS = 2_000_000;

/** Diff aproximado sem ordem: o que sumiu do "antes" e o que apareceu no "depois" (multiconjunto). */
function approximateOps(before: string[], after: string[]): DiffOp[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after) {
    const c = counts.get(line) ?? 0;
    if (c > 0) counts.set(line, c - 1);
    else added.push(line);
  }
  const removed: string[] = [];
  for (const line of before) {
    const c = counts.get(line) ?? 0;
    if (c > 0) {
      removed.push(line);
      counts.set(line, c - 1);
    }
  }
  return [...removed.map((text) => ({ type: 'del' as const, text })), ...added.map((text) => ({ type: 'add' as const, text }))];
}

/** LCS clássico entre duas listas de linhas, devolvendo as operações na ordem do texto. */
function lcsOps(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  // table[i][j] = tamanho do LCS de before[i..] e after[j..]
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ type: 'same', text: before[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ type: 'del', text: before[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: after[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', text: before[i++] });
  while (j < m) ops.push({ type: 'add', text: after[j++] });
  return ops;
}

/**
 * Diferença por linhas entre `before` e `after`. Começo e fim iguais são
 * marcados como "same" sem entrar no LCS; o miolo passa pelo LCS quando cabe
 * em MAX_CELLS, senão pelo diff aproximado.
 */
export function diffLines(before: string, after: string): PromptDiff {
  const a = toLines(before);
  const b = toLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const approximate = midA.length * midB.length > MAX_CELLS;
  const middle = approximate ? approximateOps(midA, midB) : lcsOps(midA, midB);

  const ops: DiffOp[] = [
    ...a.slice(0, prefix).map((text) => ({ type: 'same' as const, text })),
    ...middle,
    ...a.slice(a.length - suffix).map((text) => ({ type: 'same' as const, text })),
  ];

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'del') removed++;
  }

  return {
    ops,
    added,
    removed,
    before: { lines: a.length, chars: before.length },
    after: { lines: b.length, chars: after.length },
    approximate,
  };
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : pluralForm}`;
}

/** Resumo legível em pt-BR: "3 linhas adicionadas, 1 linha removida. Linhas: 40 para 42. Caracteres: 2.100 para 2.180." */
export function describeDiff(diff: PromptDiff): string {
  const changes =
    diff.added === 0 && diff.removed === 0
      ? 'Nenhuma linha mudou'
      : [
          diff.added > 0 ? `${plural(diff.added, 'linha adicionada', 'linhas adicionadas')}` : '',
          diff.removed > 0 ? `${plural(diff.removed, 'linha removida', 'linhas removidas')}` : '',
        ]
          .filter(Boolean)
          .join(', ');
  const lines = `Linhas: ${diff.before.lines.toLocaleString('pt-BR')} para ${diff.after.lines.toLocaleString('pt-BR')}`;
  const chars = `Caracteres: ${diff.before.chars.toLocaleString('pt-BR')} para ${diff.after.chars.toLocaleString('pt-BR')}`;
  return `${changes}. ${lines}. ${chars}.${diff.approximate ? ' (comparação aproximada, texto muito grande)' : ''}`;
}
