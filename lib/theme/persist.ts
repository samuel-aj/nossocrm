/**
 * Preferência de aparência POR USUÁRIO (user_settings.ui_theme / ui_mode).
 *
 * O localStorage continua sendo a cópia rápida (aplica antes da primeira
 * pintura); o banco guarda a escolha para valer em qualquer aparelho. Tudo
 * aqui é tolerante: banco sem as colunas (migração ainda não aplicada) ou
 * sem sessão só deixa a preferência local, sem erro na tela.
 */
import { supabase } from '@/lib/supabase';
import { isAppearanceMode, isThemeId, type AppearanceMode, type ThemeId } from './themes';

export type ThemePrefs = { theme: ThemeId | null; mode: AppearanceMode | null };

/** Preferência salva no banco para o usuário logado (nulls quando não há). */
export async function loadThemePrefs(userId: string): Promise<ThemePrefs> {
  try {
    const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return { theme: null, mode: null };
    const row = data as Record<string, unknown>;
    return {
      theme: isThemeId(row.ui_theme) ? row.ui_theme : null,
      mode: isAppearanceMode(row.ui_mode) ? row.ui_mode : null,
    };
  } catch {
    return { theme: null, mode: null };
  }
}

/** Grava a preferência (upsert por user_id). Nunca lança. */
export async function saveThemePrefs(userId: string, prefs: Partial<ThemePrefs>): Promise<void> {
  try {
    const patch: Record<string, unknown> = { user_id: userId };
    if (prefs.theme !== undefined) patch.ui_theme = prefs.theme;
    if (prefs.mode !== undefined) patch.ui_mode = prefs.mode;
    const { error } = await supabase.from('user_settings').upsert(patch, { onConflict: 'user_id' });
    if (error) console.warn('[tema] preferência não salva no servidor:', error.message);
  } catch (e) {
    console.warn('[tema] preferência não salva no servidor:', e);
  }
}
