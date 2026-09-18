import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Quem está alterando os dados quando o servidor grava com a service role:
 * robô, agente de IA, integração (API pública) ou sistema. O banco lê os
 * cabeçalhos x-crm-actor-kind / x-crm-actor-id (crm_internal.current_actor) e
 * grava o autor no histórico do lead. Com usuário logado o banco ignora o
 * cabeçalho e usa o próprio usuário.
 */
export type CrmActor = { kind: 'bot' | 'agent' | 'integration' | 'system'; id?: string | null };

const WRITE_METHODS = new Set(['select', 'insert', 'update', 'upsert', 'delete']);

type HeaderBuilder = { setHeader: (name: string, value: string) => unknown };

function tag<T>(builder: T, actor: CrmActor): T {
  const b = builder as unknown as HeaderBuilder;
  if (typeof b?.setHeader !== 'function') return builder;
  b.setHeader('x-crm-actor-kind', actor.kind);
  if (actor.id) b.setHeader('x-crm-actor-id', actor.id);
  return builder;
}

/** Mesmo cliente, com o autor em todas as consultas e RPCs. */
export function withActor<T extends SupabaseClient>(client: T, actor: CrmActor): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          const qb = target.from(table);
          return new Proxy(qb, {
            get(q, m, r) {
              const v = Reflect.get(q, m, r);
              if (typeof v !== 'function') return v;
              if (typeof m === 'string' && WRITE_METHODS.has(m)) {
                return (...args: unknown[]) => tag((v as (...a: unknown[]) => unknown).apply(q, args), actor);
              }
              return (v as (...a: unknown[]) => unknown).bind(q);
            },
          });
        };
      }
      if (prop === 'rpc') {
        return (...args: Parameters<T['rpc']>) =>
          tag((target.rpc as (...a: unknown[]) => unknown).apply(target, args), actor);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
