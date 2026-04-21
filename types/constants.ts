/**
 * @fileoverview Constants e enums do dominio NossoCRM.
 *
 * Centraliza magic strings usadas em roles, prioridades, status, etc.
 * Importar daqui ao inves de repetir strings literais no codigo.
 *
 * @example
 * ```ts
 * import { UserRole, DealPriority } from '@/types/constants';
 *
 * if (profile.role === UserRole.ADMIN) { ... }
 * ```
 */

// =============================================================================
// USER ROLES
// =============================================================================

export const UserRole = {
  ADMIN: 'admin',
  VENDEDOR: 'vendedor',
  SUPER_ADMIN: 'super_admin',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// =============================================================================
// DEAL PRIORITIES
// =============================================================================

export const DealPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type DealPriority = (typeof DealPriority)[keyof typeof DealPriority];

// =============================================================================
// ACTIVITY TYPES
// =============================================================================

export const ActivityType = {
  CALL: 'call',
  EMAIL: 'email',
  MEETING: 'meeting',
  TASK: 'task',
  NOTE: 'note',
  WHATSAPP: 'whatsapp',
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

// =============================================================================
// WEBHOOK STATUS
// =============================================================================

export const WebhookStatus = {
  RECEIVED: 'received',
  PROCESSED: 'processed',
  FAILED: 'failed',
} as const;

export type WebhookStatus = (typeof WebhookStatus)[keyof typeof WebhookStatus];

// =============================================================================
// AI PROVIDERS
// =============================================================================

export const AIProvider = {
  GOOGLE: 'google',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
} as const;

export type AIProvider = (typeof AIProvider)[keyof typeof AIProvider];
