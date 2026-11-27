import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261127171912_wa_ai_agent_knowledge_gaps.sql'), 'utf8');

describe('migração das dúvidas sem resposta', () => {
  it('cria a tabela privada, acessível só pelo servidor', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.wa_ai_agent_knowledge_gaps/);
    expect(sql).toMatch(/ALTER TABLE public\.wa_ai_agent_knowledge_gaps ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.wa_ai_agent_knowledge_gaps FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.wa_ai_agent_knowledge_gaps TO service_role/);
  });

  it('a RPC roda como definidor com search_path fixo, trava por agente e só o servidor executa', () => {
    expect(sql).toMatch(/FUNCTION public\.wa_ai_record_knowledge_gap\([\s\S]*?SECURITY DEFINER SET search_path = public/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.wa_ai_record_knowledge_gap\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.wa_ai_record_knowledge_gap\([^)]*\) TO service_role/);
  });

  it('liga os trechos às dúvidas e apaga o trecho junto com a dúvida', () => {
    expect(sql).toMatch(/ALTER TABLE public\.wa_ai_agent_chunks ADD COLUMN IF NOT EXISTS gap_id uuid REFERENCES public\.wa_ai_agent_knowledge_gaps\(id\) ON DELETE CASCADE/);
  });
});
