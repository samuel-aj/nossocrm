'use client';

/**
 * Liga a aparência/tema do usuário ao banco (user_settings.ui_theme/ui_mode):
 * - ao entrar, aplica a preferência salva no servidor (vale em qualquer aparelho);
 * - quando o usuário muda na tela de Aparência (ou no botão do cabeçalho),
 *   grava no servidor em segundo plano.
 * Sem sessão ou sem as colunas no banco, nada acontece (a escolha fica local).
 */
import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { setThemeChangeListener, useTheme } from '@/context/ThemeContext';
import { loadThemePrefs, saveThemePrefs } from '@/lib/theme/persist';

export default function ThemeSync() {
  const { user } = useAuth();
  const { applyServerPrefs } = useTheme();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setThemeChangeListener(null);
      return;
    }
    let cancelled = false;
    void loadThemePrefs(userId).then((prefs) => {
      if (!cancelled && (prefs.theme || prefs.mode)) applyServerPrefs(prefs);
    });
    setThemeChangeListener((prefs) => void saveThemePrefs(userId, prefs));
    return () => {
      cancelled = true;
      setThemeChangeListener(null);
    };
  }, [userId, applyServerPrefs]);

  return null;
}
