/**
 * Substituição de variáveis {{a.b.c}} em textos (roteiro, mensagens do robô,
 * corpo dos webhooks).
 */

/** Forma de uma variável no texto: `{{a.b.c}}`. Fonte única (a UI destaca com o mesmo padrão). */
export const VAR_PATTERN = '\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}';

const VAR_RE = new RegExp(VAR_PATTERN, 'g');

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
  const escaped = template.replace(VAR_RE, (_m, path: string) => {
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
