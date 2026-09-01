/**
 * Permissões de visualização por usuário (Configurações > Equipe).
 *
 * CLIENT-SAFE: só zod, tipos e constantes.
 *
 * O formato espelha o jsonb de user_visibility_rules e as funções
 * vis_can_see_owner / vis_can_see_board do banco (migração 20260901220000):
 *   - deals.scope: 'own' (só os próprios) | 'team' (os da lista) | 'all'
 *   - boards.board_ids: null = todos | lista de quadros permitidos
 *   - whatsapp.connection_ids: null = todos | lista de números permitidos
 *
 * Leads sem responsável são sempre visíveis (alguém precisa poder assumir).
 * Admins e super admins nunca são restringidos.
 */
import { z } from 'zod';

export const VISIBILITY_SCOPES = ['own', 'team', 'all'] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

export const VisibilityRulesSchema = z.object({
  deals: z
    .object({
      scope: z.enum(VISIBILITY_SCOPES).default('all'),
      team_user_ids: z.array(z.string().uuid()).max(100).default([]),
    })
    .default({ scope: 'all', team_user_ids: [] }),
  boards: z
    .object({
      board_ids: z.array(z.string().uuid()).max(200).nullable().default(null),
    })
    .default({ board_ids: null }),
  whatsapp: z
    .object({
      connection_ids: z.array(z.string().uuid()).max(50).nullable().default(null),
    })
    .default({ connection_ids: null }),
});
export type VisibilityRules = z.infer<typeof VisibilityRulesSchema>;

export const DEFAULT_VISIBILITY_RULES: VisibilityRules = {
  deals: { scope: 'all', team_user_ids: [] },
  boards: { board_ids: null },
  whatsapp: { connection_ids: null },
};

/** true quando a regra não restringe nada (aí a linha é apagada em vez de salva). */
export function isUnrestricted(rules: VisibilityRules): boolean {
  return (
    rules.deals.scope === 'all' &&
    rules.boards.board_ids === null &&
    rules.whatsapp.connection_ids === null
  );
}

/** Regra crua (jsonb do banco) no formato completo; inválida vira "sem restrição". */
export function normalizeVisibilityRules(raw: unknown): VisibilityRules {
  const p = VisibilityRulesSchema.safeParse(raw ?? {});
  return p.success ? p.data : { ...DEFAULT_VISIBILITY_RULES };
}
