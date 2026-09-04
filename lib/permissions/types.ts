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

/**
 * Permissões de AÇÃO (o que o vendedor pode FAZER, além do que pode ver).
 * true = liberado (padrão de sempre); false = bloqueado no banco (triggers
 * vis_guard_* e política de SELECT em contacts, migração 20260904).
 */
export const ActionPermissionsSchema = z.object({
  contacts: z
    .object({
      view: z.boolean().default(true),
      create: z.boolean().default(true),
      edit: z.boolean().default(true),
      delete: z.boolean().default(true),
    })
    .default({ view: true, create: true, edit: true, delete: true }),
  deals: z
    .object({
      create: z.boolean().default(true),
      edit: z.boolean().default(true),
      delete: z.boolean().default(true),
      /** mover cards entre etapas do kanban */
      move: z.boolean().default(true),
    })
    .default({ create: true, edit: true, delete: true, move: true }),
});
export type ActionPermissions = z.infer<typeof ActionPermissionsSchema>;

export const DEFAULT_ACTION_PERMISSIONS: ActionPermissions = {
  contacts: { view: true, create: true, edit: true, delete: true },
  deals: { create: true, edit: true, delete: true, move: true },
};

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
      /** null = todas as conversas; lista = só conversas com AO MENOS UMA destas etiquetas */
      label_ids: z.array(z.string().uuid()).max(50).nullable().default(null),
      /**
       * null = conversas de qualquer responsável; lista = só conversas cujo
       * RESPONSÁVEL (dono do lead do contato, como no filtro dos Chats) seja o
       * próprio usuário ou alguém da lista. Sem responsável = sempre visível.
       */
      owner_user_ids: z.array(z.string().uuid()).max(100).nullable().default(null),
    })
    .default({ connection_ids: null, label_ids: null, owner_user_ids: null }),
  actions: ActionPermissionsSchema.default(DEFAULT_ACTION_PERMISSIONS),
});
export type VisibilityRules = z.infer<typeof VisibilityRulesSchema>;

export const DEFAULT_VISIBILITY_RULES: VisibilityRules = {
  deals: { scope: 'all', team_user_ids: [] },
  boards: { board_ids: null },
  whatsapp: { connection_ids: null, label_ids: null, owner_user_ids: null },
  actions: DEFAULT_ACTION_PERMISSIONS,
};

/** true quando nenhuma AÇÃO está bloqueada. */
export function actionsUnrestricted(a: ActionPermissions): boolean {
  return (
    a.contacts.view && a.contacts.create && a.contacts.edit && a.contacts.delete &&
    a.deals.create && a.deals.edit && a.deals.delete && a.deals.move
  );
}

/** true quando a regra não restringe nada (aí a linha é apagada em vez de salva). */
export function isUnrestricted(rules: VisibilityRules): boolean {
  return (
    rules.deals.scope === 'all' &&
    rules.boards.board_ids === null &&
    rules.whatsapp.connection_ids === null &&
    rules.whatsapp.label_ids === null &&
    rules.whatsapp.owner_user_ids === null &&
    actionsUnrestricted(rules.actions)
  );
}

/** Regra crua (jsonb do banco) no formato completo; inválida vira "sem restrição". */
export function normalizeVisibilityRules(raw: unknown): VisibilityRules {
  const p = VisibilityRulesSchema.safeParse(raw ?? {});
  return p.success ? p.data : { ...DEFAULT_VISIBILITY_RULES };
}
