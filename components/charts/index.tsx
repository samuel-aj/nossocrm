import React, { Suspense, lazy } from 'react';

// Chart loading skeleton
/**
 * Componente React `ChartSkeleton`.
 *
 * @param {{ height?: string | number | undefined; }} { height = 320 } - Parâmetro `{ height = 320 }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ChartSkeleton: React.FC<{ height?: number | string }> = ({ height = 320 }) => (
  <div
    className="animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg w-full flex items-center justify-center"
    style={{ height }}
  >
    <div className="text-slate-400 dark:text-slate-500 text-sm">Carregando gráfico...</div>
  </div>
);

// Lazy loaded chart components
export const LazyFunnelChart = lazy(() => import('./FunnelChart'));
export const LazyRevenueTrendChart = lazy(() => import('./RevenueTrendChart'));
export const LazyStageConversionChart = lazy(() => import('./StageConversionChart'));

// Wrapper component for charts with suspense
interface ChartWrapperProps {
  children: React.ReactNode;
  height?: number | string;
}

/**
 * Componente React `ChartWrapper`.
 *
 * @param {ChartWrapperProps} { children, height = 320 } - Parâmetro `{ children, height = 320 }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ChartWrapper: React.FC<ChartWrapperProps> = ({ children, height = 320 }) => (
  <Suspense fallback={<ChartSkeleton height={height} />}>{children}</Suspense>
);
