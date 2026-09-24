import { z } from 'zod';

export const PreferencesSchema = z.object({
  alerts: z.boolean().default(true),
  messages: z.boolean(), scope: z.enum(['own', 'all']), leads: z.boolean(),
  boardIds: z.array(z.string().uuid()).max(200), desktop: z.boolean(), sound: z.boolean(),
  soundType: z.enum(['current', 'chime', 'alert']).default('current'),
  volume: z.number().int().min(0).max(100).default(40),
}).strict();
export type Preferences = z.infer<typeof PreferencesSchema>;
export const DEFAULT_PREFERENCES: Preferences = {
  alerts: true, messages: false, scope: 'own', leads: false, boardIds: [], desktop: false, sound: false,
  soundType: 'current', volume: 40,
};
export interface Notice { id: string; kind: 'message' | 'lead' | 'alert'; title: string; message: string; href: string; createdAt: string }
export interface NotificationSettings { preferences: Preferences; boards: Array<{id: string; name: string}> }
export interface NotificationFeed { events: Notice[]; serverTime: string; nextAfter: string | null }
