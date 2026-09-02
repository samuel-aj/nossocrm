/**
 * @fileoverview Contexto de Aparência e Tema
 *
 * Dois conceitos, independentes:
 * - **Aparência** (`mode`): claro, escuro ou sistema. Aplica a classe `dark`
 *   no <html>. Compatível com o antigo `darkMode`/`toggleDarkMode` (o botão
 *   do cabeçalho continua funcionando).
 * - **Tema** (`theme`): paleta de cores (roxo, grafite, azul...). Aplica
 *   `data-theme` no <html>; o CSS gerado em lib/theme/themes.ts redefine as
 *   variáveis de cor e os componentes mudam sozinhos. Roxo é o padrão e não
 *   altera nada.
 *
 * Persistência: localStorage (rápido, aplicado antes da primeira pintura pelo
 * script do layout) + user_settings no banco (por usuário; ver ThemeSync).
 *
 * @module context/ThemeContext
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  DEFAULT_THEME,
  LEGACY_DARK_KEY,
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isAppearanceMode,
  isThemeId,
  normalizeThemeId,
  type AppearanceMode,
  type ThemeId,
} from '@/lib/theme/themes';

interface ThemeContextType {
  /** Se o modo escuro está ativo agora (já resolvido o "sistema") */
  darkMode: boolean;
  /** Alterna claro/escuro (vira uma escolha explícita, mesmo se estava em "sistema") */
  toggleDarkMode: () => void;
  /** Aparência escolhida: claro, escuro ou sistema */
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
  /** Tema (paleta) escolhido */
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  /**
   * Aplica a preferência vinda do servidor (user_settings) sem gravar de volta.
   * Usado pelo ThemeSync ao carregar o usuário.
   */
  applyServerPrefs: (prefs: { theme: ThemeId | null; mode: AppearanceMode | null }) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Valor JSON salvo no localStorage (undefined quando não há). */
function readStored<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Callback opcional chamado quando o usuário muda tema/aparência (o ThemeSync grava no banco). */
type ChangeListener = (prefs: { theme?: ThemeId; mode?: AppearanceMode }) => void;
let changeListener: ChangeListener | null = null;
export function setThemeChangeListener(fn: ChangeListener | null) {
  changeListener = fn;
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Chave antiga (boolean). Continua sendo a fonte quando ninguém escolheu um modo.
  const [legacyDark, setLegacyDark] = usePersistedState<boolean>(LEGACY_DARK_KEY, true);
  const [modeStored, setModeStored] = usePersistedState<AppearanceMode | null>(MODE_STORAGE_KEY, null);
  const [themeStored, setThemeStored] = usePersistedState<ThemeId>(THEME_STORAGE_KEY, DEFAULT_THEME);
  const [systemDark, setSystemDark] = React.useState<boolean>(true);

  const mode: AppearanceMode = modeStored ?? (legacyDark ? 'dark' : 'light');
  const theme: ThemeId = normalizeThemeId(themeStored);
  const darkMode = mode === 'system' ? systemDark : mode === 'dark';

  // Acompanha a preferência do sistema (só importa no modo "sistema").
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Aplica a classe `dark`. Na primeira renderização o estado ainda é o
  // padrão (o localStorage só é lido no efeito do usePersistedState): se o
  // valor salvo for outro, não mexe no DOM, que o script do layout já acertou.
  useEffect(() => {
    const storedMode = readStored<AppearanceMode | null>(MODE_STORAGE_KEY);
    const storedLegacy = readStored<boolean>(LEGACY_DARK_KEY);
    const staleMode = storedMode !== undefined && storedMode !== modeStored;
    const staleLegacy = storedLegacy !== undefined && storedLegacy !== legacyDark;
    if (staleMode || staleLegacy) return;
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode, modeStored, legacyDark]);

  // Aplica `data-theme` (roxo = sem atributo = visual atual).
  useEffect(() => {
    const stored = readStored<ThemeId>(THEME_STORAGE_KEY);
    if (stored !== undefined && stored !== themeStored) return;
    if (theme === DEFAULT_THEME) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme, themeStored]);

  const setMode = useCallback(
    (next: AppearanceMode) => {
      setModeStored(next);
      // A chave antiga acompanha (quem ler só ela continua coerente).
      if (next !== 'system') setLegacyDark(next === 'dark');
      changeListener?.({ mode: next });
    },
    [setModeStored, setLegacyDark]
  );

  const setTheme = useCallback(
    (next: ThemeId) => {
      const value = normalizeThemeId(next);
      setThemeStored(value);
      changeListener?.({ theme: value });
    },
    [setThemeStored]
  );

  const toggleDarkMode = useCallback(() => setMode(darkMode ? 'light' : 'dark'), [darkMode, setMode]);

  const applyServerPrefs = useCallback(
    (prefs: { theme: ThemeId | null; mode: AppearanceMode | null }) => {
      if (prefs.theme) setThemeStored(normalizeThemeId(prefs.theme));
      if (prefs.mode && isAppearanceMode(prefs.mode)) {
        setModeStored(prefs.mode);
        if (prefs.mode !== 'system') setLegacyDark(prefs.mode === 'dark');
      }
    },
    [setThemeStored, setModeStored, setLegacyDark]
  );

  const value = useMemo<ThemeContextType>(
    () => ({ darkMode, toggleDarkMode, mode, setMode, theme, setTheme, applyServerPrefs }),
    [darkMode, toggleDarkMode, mode, setMode, theme, setTheme, applyServerPrefs]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Hook para acessar aparência e tema. Deve ser usado dentro de um ThemeProvider.
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
