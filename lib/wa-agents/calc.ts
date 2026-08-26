/**
 * Avaliador seguro de expressões aritméticas (ferramenta calcular do agente).
 *
 * Shunting-yard com avaliação imediata: números, + - * / % ^, parênteses e as
 * funções sqrt, abs, round, floor, ceil, min, max e pow. Qualquer identificador
 * desconhecido, sintaxe inválida ou resultado não finito lança
 * `Error('expressão inválida')`. Nada de eval.
 *
 * CLIENT-SAFE: só funções puras.
 */

export const CALC_MAX_LENGTH = 500;

type Frame = { func: string | null; argc: number; sawValue: boolean };

type OpToken = { kind: 'op'; op: string } | { kind: 'func'; name: string } | { kind: 'lparen' };

type FunctionDef = { min: number; max: number; fn: (...args: number[]) => number };

const FUNCTIONS: Record<string, FunctionDef> = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  abs: { min: 1, max: 1, fn: Math.abs },
  round: {
    min: 1,
    max: 2,
    fn: (x, digits = 0) => {
      const d = Math.max(0, Math.min(12, Math.trunc(digits)));
      const f = 10 ** d;
      return Math.round(x * f) / f;
    },
  },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  min: { min: 1, max: Infinity, fn: Math.min },
  max: { min: 1, max: Infinity, fn: Math.max },
  pow: { min: 2, max: 2, fn: Math.pow },
};

/** Precedência dos operadores binários e unários ('neg'/'pos' são prefixos). */
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, neg: 3, pos: 3, '^': 4 };
const RIGHT_ASSOC = new Set(['^', 'neg', 'pos']);

/** Nomes das funções aceitas (para a descrição da ferramenta). */
export const CALC_FUNCTIONS = Object.keys(FUNCTIONS);

function invalid(): never {
  throw new Error('expressão inválida');
}

/** Sinais tipográficos que o modelo pode escrever no lugar dos operadores. */
function normalizeOperators(expr: string): string {
  return expr
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');
}

function applyOp(values: number[], op: string): void {
  if (op === 'neg' || op === 'pos') {
    const a = values.pop();
    if (a === undefined) invalid();
    values.push(op === 'neg' ? -a : a);
    return;
  }
  const b = values.pop();
  const a = values.pop();
  if (a === undefined || b === undefined) invalid();
  switch (op) {
    case '+':
      values.push(a + b);
      return;
    case '-':
      values.push(a - b);
      return;
    case '*':
      values.push(a * b);
      return;
    case '/':
      if (b === 0) invalid();
      values.push(a / b);
      return;
    case '%':
      if (b === 0) invalid();
      values.push(a % b);
      return;
    case '^':
      values.push(Math.pow(a, b));
      return;
    default:
      invalid();
  }
}

function applyFunc(values: number[], name: string, argc: number): void {
  const def = FUNCTIONS[name];
  if (!def) invalid();
  if (argc < def.min || argc > def.max) invalid();
  if (values.length < argc) invalid();
  const args = values.splice(values.length - argc, argc);
  values.push(def.fn(...args));
}

/**
 * Avalia uma expressão aritmética. Ex.: `evaluateExpression('round(1500 * 0.3, 2)')` -> 450.
 * Lança `Error('expressão inválida')` em qualquer erro.
 */
export function evaluateExpression(expr: string): number {
  const src = normalizeOperators((expr ?? '').trim());
  if (!src || src.length > CALC_MAX_LENGTH) invalid();

  const values: number[] = [];
  const ops: OpToken[] = [];
  const frames: Frame[] = [];
  /** true quando o próximo + ou - é unário (início, depois de operador, "(" ou ",") */
  let expectOperand = true;

  const markValue = () => {
    const f = frames[frames.length - 1];
    if (f) f.sawValue = true;
    expectOperand = false;
  };

  const popWhile = (pred: (top: OpToken) => boolean) => {
    while (ops.length > 0) {
      const top = ops[ops.length - 1];
      if (!pred(top)) break;
      ops.pop();
      if (top.kind === 'op') applyOp(values, top.op);
      else invalid();
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Número (ponto decimal; notação científica simples)
    if ((ch >= '0' && ch <= '9') || (ch === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      if (!expectOperand) invalid();
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) invalid();
      const n = Number(m[0]);
      if (!Number.isFinite(n)) invalid();
      values.push(n);
      i += m[0].length;
      markValue();
      continue;
    }

    // Identificador: só funções conhecidas, sempre seguidas de "("
    if (/[a-zA-Z_]/.test(ch)) {
      if (!expectOperand) invalid();
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
      if (!m) invalid();
      const name = m[0].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) invalid();
      i += m[0].length;
      // pula espaços até o parêntese
      while (i < src.length && src[i] === ' ') i++;
      if (src[i] !== '(') invalid();
      ops.push({ kind: 'func', name });
      ops.push({ kind: 'lparen' });
      frames.push({ func: name, argc: 0, sawValue: false });
      i++;
      expectOperand = true;
      continue;
    }

    if (ch === '(') {
      if (!expectOperand) invalid();
      ops.push({ kind: 'lparen' });
      frames.push({ func: null, argc: 0, sawValue: false });
      i++;
      expectOperand = true;
      continue;
    }

    if (ch === ')') {
      const frame = frames.pop();
      if (!frame) invalid();
      popWhile(top => top.kind !== 'lparen');
      const lp = ops.pop();
      if (!lp || lp.kind !== 'lparen') invalid();
      if (frame.func) {
        const fn = ops.pop();
        if (!fn || fn.kind !== 'func') invalid();
        // argc conta as vírgulas; "()" vazio ou vírgula pendurada são inválidos
        if (!frame.sawValue) invalid();
        applyFunc(values, frame.func, frame.argc + 1);
      } else if (!frame.sawValue) {
        invalid();
      }
      i++;
      markValue();
      continue;
    }

    if (ch === ',') {
      const frame = frames[frames.length - 1];
      if (!frame || !frame.func || !frame.sawValue) invalid();
      popWhile(top => top.kind !== 'lparen');
      frame.argc++;
      frame.sawValue = false;
      i++;
      expectOperand = true;
      continue;
    }

    if ('+-*/%^'.includes(ch)) {
      let op = ch;
      if (expectOperand) {
        if (ch === '-') op = 'neg';
        else if (ch === '+') op = 'pos';
        else invalid();
        // prefixo: não desempilha nada
        ops.push({ kind: 'op', op });
        i++;
        continue;
      }
      const prec = PRECEDENCE[op];
      popWhile(top => {
        if (top.kind !== 'op') return false;
        const tp = PRECEDENCE[top.op];
        return tp > prec || (tp === prec && !RIGHT_ASSOC.has(op));
      });
      ops.push({ kind: 'op', op });
      i++;
      expectOperand = true;
      continue;
    }

    invalid();
  }

  if (expectOperand || frames.length > 0) invalid();
  popWhile(() => true);
  if (values.length !== 1) invalid();
  const result = values[0];
  if (!Number.isFinite(result)) invalid();
  // Evita -0 no resultado
  return result === 0 ? 0 : result;
}

/** Resultado em texto para o modelo (até 10 casas, sem zeros à direita). */
export function formatCalcResult(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(10)));
}
