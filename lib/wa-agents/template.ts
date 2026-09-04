/**
 * Substituição de variáveis {{a.b.c}} em textos (roteiro, mensagens do robô,
 * corpo dos webhooks).
 */

/** Forma de uma variável no texto: `{{a.b.c}}`. Fonte única (a UI destaca com o mesmo padrão). */
export const VAR_PATTERN = '\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}';

const VAR_RE = new RegExp(VAR_PATTERN, 'g');

/**
 * Variável PREENCHIDA PELA IA na hora de executar a ação: `{{ia:nome}}`.
 * Padrão separado do VAR_PATTERN de propósito: o roteiro NÃO resolve `ia:`
 * (a IA só preenche nas ações), então um `{{ia:x}}` escrito no roteiro
 * continua intocado em vez de sumir.
 */
export const AI_VAR_PATTERN = '\\{\\{\\s*ia:([a-z0-9_]+)\\s*\\}\\}';

const AI_VAR_RE = new RegExp(AI_VAR_PATTERN, 'gi');

/** Token pronto de uma variável de IA: 'motivo' -> '{{ia:motivo}}'. */
export function aiVarToken(name: string): string {
  return `{{ia:${name}}}`;
}

/** Nomes das variáveis de IA usadas num texto (minúsculos, sem repetição, na ordem). */
export function extractAiVarNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(new RegExp(AI_VAR_PATTERN, 'gi'))) {
    const name = (m[1] ?? '').toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Substitui {{ia:nome}} pelos valores gerados ('' quando a IA não devolveu o nome). */
export function renderAiVars(text: string, values: Record<string, string>): string {
  if (!text) return '';
  return text.replace(AI_VAR_RE, (_m, name: string) => values[name.toLowerCase()] ?? '');
}

/** Resolve um caminho "a.b.c" dentro de um objeto; undefined se não existir. */
export function getPath(vars: Record<string, unknown>, path: string): unknown {
  // Primeiro tenta a chave literal (ex.: 'negocio.titulo' pode ser uma chave plana)
  if (Object.prototype.hasOwnProperty.call(vars, path)) return vars[path];
  let cur: unknown = vars;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Substitui {{a.b.c}} por String(valor) ou '' quando não existe. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  if (!template) return '';
  return template.replace(VAR_RE, (_m, path: string) => toText(getPath(vars, path.trim())));
}

/**
 * Versão para corpos JSON: os valores substituídos são escapados como conteúdo
 * de string JSON (aspas, quebras de linha), para o modelo `{"nome": "{{contact.name}}"}`
 * continuar válido. Tenta JSON.parse do resultado; se falhar, devolve a string
 * renderizada sem escape.
 */
export function renderJsonTemplate(template: string, vars: Record<string, unknown>): unknown {
  if (!template) return '';
  // Campo cujo valor é SÓ uma variável ("{{a.b}}") e que não existe no payload
  // vira null, não "": integrações costumam validar o formato do campo (e-mail,
  // CPF) e recusam string vazia, enquanto null significa "não informado".
  // Valor presente — inclusive string vazia vinda do dado — segue como string.
  const QUOTED_VAR_RE = new RegExp(`"${VAR_PATTERN}"`, 'g');
  const comNulos = template.replace(QUOTED_VAR_RE, (m, path: string) => {
    const value = getPath(vars, path.trim());
    return value === null || value === undefined ? 'null' : m;
  });
  const escaped = comNulos.replace(VAR_RE, (_m, path: string) => {
    const text = toText(getPath(vars, path.trim()));
    // JSON.stringify devolve a string entre aspas; tiramos as aspas externas
    return JSON.stringify(text).slice(1, -1);
  });
  try {
    return JSON.parse(escaped);
  } catch {
    return renderTemplate(template, vars);
  }
}
