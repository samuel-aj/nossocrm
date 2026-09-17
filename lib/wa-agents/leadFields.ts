/**
 * Valores de lead escritos por robôs e agentes de IA: conversão de campo
 * personalizado pelo tipo (texto, número, moeda, data, seleção, múltipla
 * seleção) e montagem das alterações de um lead (manter, substituir, anexar,
 * limpar). Sem acesso a banco: usado pelo motor e pela validação da tela.
 *
 * Formato gravado em deals.custom_fields (o mesmo da tela do lead):
 * número/moeda = número JSON; data = "AAAA-MM-DD"; seleção = a opção exata;
 * múltipla = lista de opções; limpo = null.
 */
import { normalizeKeyword } from './text';

export type CustomFieldDef = {
  key: string;
  label?: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'currency' | string;
  options?: string[] | null;
};

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

/** "1.234,56" / "1234.56" / "R$ 10" -> número (null quando não é número). */
export function parseNumberPtBr(raw: string): number | null {
  let s = raw.replace(/R\$|\s/g, '').trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "31/12/2026" ou "2026-12-31" -> "2026-12-31" (null quando não é data válida). */
export function parseDateBr(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Opção cadastrada que corresponde ao texto (sem acento/maiúscula), ou null. */
export function matchOption(options: string[] | null | undefined, raw: string): string | null {
  const wanted = normalizeKeyword(raw);
  if (!wanted) return null;
  return (options ?? []).find(o => normalizeKeyword(o) === wanted) ?? null;
}

/**
 * Converte o texto (já com as variáveis preenchidas) para o valor do campo.
 * `current` é o valor atual (usado no modo "add" da múltipla seleção).
 */
export function coerceCustomFieldValue(def: CustomFieldDef, raw: string, mode: 'replace' | 'append' = 'replace', current?: unknown): CoerceResult {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'valor vazio' };
  switch (def.type) {
    case 'number':
    case 'currency': {
      const n = parseNumberPtBr(text);
      return n === null ? { ok: false, error: `"${text}" não é um número` } : { ok: true, value: n };
    }
    case 'date': {
      const d = parseDateBr(text);
      return d ? { ok: true, value: d } : { ok: false, error: `"${text}" não é uma data (use dd/mm/aaaa)` };
    }
    case 'select': {
      const opt = matchOption(def.options, text);
      return opt
        ? { ok: true, value: opt }
        : { ok: false, error: `"${text}" não é uma opção de ${def.label || def.key} (${(def.options ?? []).join(', ')})` };
    }
    case 'multiselect': {
      const parts = text.split(/[;,]/).map(p => p.trim()).filter(Boolean);
      const chosen: string[] = [];
      for (const p of parts) {
        const opt = matchOption(def.options, p);
        if (!opt) return { ok: false, error: `"${p}" não é uma opção de ${def.label || def.key}` };
        if (!chosen.includes(opt)) chosen.push(opt);
      }
      if (mode === 'append' && Array.isArray(current)) {
        const merged = [...current.map(String)];
        for (const c of chosen) if (!merged.includes(c)) merged.push(c);
        return { ok: true, value: merged };
      }
      return { ok: true, value: chosen };
    }
    default: {
      if (mode === 'append' && typeof current === 'string' && current.trim()) {
        return { ok: true, value: `${current.trim()}\n${text}`.slice(0, 4000) };
      }
      return { ok: true, value: text.slice(0, 4000) };
    }
  }
}

/** Uma alteração de lead configurada no robô/agente. Campo fora da lista = mantido. */
export type LeadChange = {
  field: 'title' | 'value' | 'description' | 'owner_id' | 'custom_field';
  key?: string;
  mode: 'replace' | 'append' | 'clear';
  value?: string;
};

export type LeadPatchResult = {
  /** Colunas diretas de deals */
  columns: Record<string, unknown>;
  /** Campos personalizados alterados (null = limpar) */
  customFields: Record<string, unknown>;
  /** Alterações que não puderam ser aplicadas, com o motivo */
  problems: string[];
};

/**
 * Monta o que muda no lead. `render` preenche as variáveis do texto;
 * `current` traz o lead atual (para anexar); `defs` os campos personalizados da org.
 */
export function buildLeadPatch(
  changes: LeadChange[],
  input: {
    render: (text: string) => string;
    current: { description?: string | null; custom_fields?: Record<string, unknown> | null; title?: string | null };
    defs: CustomFieldDef[];
  }
): LeadPatchResult {
  const columns: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};
  const problems: string[] = [];
  const currentCf = input.current.custom_fields ?? {};

  for (const ch of changes) {
    const rendered = ch.mode === 'clear' ? '' : input.render(ch.value ?? '').trim();
    switch (ch.field) {
      case 'title': {
        if (ch.mode === 'clear') problems.push('o título do lead não pode ficar vazio');
        else if (!rendered) problems.push('título: valor vazio');
        else columns.title = (ch.mode === 'append' && input.current.title ? `${input.current.title} ${rendered}` : rendered).slice(0, 200);
        break;
      }
      case 'value': {
        if (ch.mode === 'clear') {
          columns.value = 0;
          break;
        }
        const n = parseNumberPtBr(rendered);
        if (n === null) problems.push(`valor: "${rendered}" não é um número`);
        else columns.value = n;
        break;
      }
      case 'description': {
        if (ch.mode === 'clear') columns.description = null;
        else if (!rendered) problems.push('descrição: valor vazio');
        else if (ch.mode === 'append') {
          const before = (typeof columns.description === 'string' ? columns.description : input.current.description ?? '').trim();
          columns.description = before ? `${before}\n${rendered}` : rendered;
        } else columns.description = rendered;
        break;
      }
      case 'owner_id': {
        if (ch.mode === 'clear') columns.owner_id = null;
        else if (!/^[0-9a-f-]{36}$/i.test(rendered)) problems.push('responsável: escolha um usuário');
        else columns.owner_id = rendered;
        break;
      }
      case 'custom_field': {
        const key = (ch.key ?? '').trim();
        const def = input.defs.find(d => d.key === key);
        if (!def) {
          problems.push(`campo personalizado "${key}" não existe mais`);
          break;
        }
        if (ch.mode === 'clear') {
          customFields[key] = null;
          break;
        }
        const r = coerceCustomFieldValue(def, rendered, ch.mode === 'append' ? 'append' : 'replace', customFields[key] ?? currentCf[key]);
        if (r.ok) customFields[key] = r.value;
        else problems.push(`${def.label || key}: ${r.error}`);
        break;
      }
    }
  }
  return { columns, customFields, problems };
}
