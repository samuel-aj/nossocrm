import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_MIME, FEEDBACK_BUCKET, FEEDBACK_LIMITS } from './constants';

const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261128120100_feedback_bucket.sql'), 'utf8');

describe('migração do bucket de anexos', () => {
  it('aceita no bucket exatamente os tipos que a caixa aceita', () => {
    const list = /allowed_mime_types[\s\S]*?ARRAY\[([^\]]*)\]/.exec(sql)?.[1] ?? '';
    const inSql = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
    expect(inSql).toEqual(Object.values(ALLOWED_MIME).flat().sort());
  });
  it('usa o nome e o limite de tamanho das constantes', () => {
    expect(sql).toContain(`'${FEEDBACK_BUCKET}'`);
    expect(sql).toContain(String(FEEDBACK_LIMITS.bytes));
  });
});
