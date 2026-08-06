/**
 * @fileoverview Controles de paginação para a tabela de contatos.
 * 
 * Fornece navegação entre páginas (primeiro, anterior, próximo, último),
 * seletor de tamanho de página e feedback visual durante carregamento.
 * 
 * @module features/contacts/components/PaginationControls
 */

import React from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationState } from '@/types';
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '@/types';

export interface PaginationControlsProps {
  /** Estado atual de paginação { pageIndex, pageSize }. */
  pagination: PaginationState;
  /** Função para atualizar a paginação. */
  setPagination: (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => void;
  /** Total de registros no servidor. */
  totalCount: number;
  /** Se está buscando dados (para feedback visual). */
  isFetching?: boolean;
  /** Se os dados são placeholder (transição de página). */
  isPlaceholderData?: boolean;
}

/**
 * Componente de controles de paginação.
 * 
 * @example
 * ```tsx
 * <PaginationControls
 *   pagination={{ pageIndex: 0, pageSize: 50 }}
 *   setPagination={setPagination}
 *   totalCount={10000}
 *   isFetching={isFetching}
 * />
 * ```
 */
export const PaginationControls: React.FC<PaginationControlsProps> = ({
  pagination,
  setPagination,
  totalCount,
  isFetching = false,
  isPlaceholderData = false,
}) => {
  const { pageIndex, pageSize } = pagination;
  
  // Calculate page metrics
  const pageCount = Math.ceil(totalCount / pageSize);
  const canPreviousPage = pageIndex > 0;
  const canNextPage = pageIndex < pageCount - 1;
  
  // Calculate display range
  const from = pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalCount);

  // Navigation handlers
  const goToFirstPage = () => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const goToPreviousPage = () => {
    setPagination((prev) => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }));
  };

  const goToNextPage = () => {
    setPagination((prev) => ({ 
      ...prev, 
      pageIndex: Math.min(pageCount - 1, prev.pageIndex + 1) 
    }));
  };

  const goToLastPage = () => {
    setPagination((prev) => ({ ...prev, pageIndex: pageCount - 1 }));
  };

  // Page size change handler (T025 - reset to page 0)
  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPageSize = Number(e.target.value);
    setPagination({ pageIndex: 0, pageSize: newPageSize });
  };

  // Go to specific page handler (T037-T038)
  const handleGoToPage = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const input = e.currentTarget;
      let targetPage = parseInt(input.value, 10);
      
      // Validate and clamp (T038)
      if (isNaN(targetPage) || targetPage < 1) {
        targetPage = 1;
      } else if (targetPage > pageCount) {
        targetPage = pageCount;
      }
      
      setPagination((prev) => ({ ...prev, pageIndex: targetPage - 1 }));
      input.value = '';
    }
  };

  // Common button classes
  const buttonBaseClass = `
    p-1.5 rounded-md transition-colors
    focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
    dark:focus:ring-offset-dark-bg
  `;
  
  const buttonEnabledClass = `
    text-gray-600 hover:bg-gray-100 hover:text-gray-900
    dark:text-gray-400 dark:hover:bg-dark-hover dark:hover:text-gray-200
  `;
  
  const buttonDisabledClass = `
    text-gray-300 cursor-not-allowed
    dark:text-gray-600
  `;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card">
      {/* Left: Info and page size selector (T024, T026) */}
      <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 max-md:flex-wrap max-md:justify-center max-md:gap-2">
        {/* T026: Mostrando X-Y de Z */}
        <span className={isFetching ? 'animate-pulse' : ''}>
          Mostrando {totalCount > 0 ? from : 0}-{to} de {totalCount.toLocaleString('pt-BR')} contatos
        </span>
        
        {/* T024: Page size selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="page-size" className="sr-only">
            Itens por página
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={handlePageSizeChange}
            disabled={isFetching}
            className="
              px-2 py-1 text-sm rounded-md border border-gray-200
              bg-white dark:bg-dark-card dark:border-dark-border
              focus:outline-none focus:ring-2 focus:ring-primary-500
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            aria-label="Selecionar quantidade de itens por página"
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>
                {size} por página
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: Navigation controls (T015-T016) */}
      <div className="flex items-center gap-2">
        {/* T036: Go to page input */}
        <div className="hidden sm:flex items-center gap-2 mr-4">
          <label htmlFor="goto-page" className="text-sm text-gray-600 dark:text-gray-400">
            Ir para:
          </label>
          <input
            id="goto-page"
            type="number"
            min={1}
            max={pageCount}
            placeholder={String(pageIndex + 1)}
            onKeyDown={handleGoToPage}
            disabled={isFetching || pageCount <= 1}
            className="
              w-16 px-2 py-1 text-sm text-center rounded-md border border-gray-200
              bg-white dark:bg-dark-card dark:border-dark-border
              focus:outline-none focus:ring-2 focus:ring-primary-500
              disabled:opacity-50 disabled:cursor-not-allowed
              [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
            "
            aria-label="Ir para página específica"
          />
        </div>

        {/* Page indicator */}
        <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
          Página {pageIndex + 1} de {pageCount || 1}
        </span>

        {/* Navigation buttons (T015) */}
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            onClick={goToFirstPage}
            disabled={!canPreviousPage || isFetching}
            className={`${buttonBaseClass} ${canPreviousPage && !isFetching ? buttonEnabledClass : buttonDisabledClass}`}
            aria-label="Ir para primeira página"
            title="Primeira página"
          >
            <ChevronFirst className="w-5 h-5" />
          </button>

          {/* Previous page */}
          <button
            onClick={goToPreviousPage}
            disabled={!canPreviousPage || isFetching}
            className={`${buttonBaseClass} ${canPreviousPage && !isFetching ? buttonEnabledClass : buttonDisabledClass}`}
            aria-label="Ir para página anterior"
            title="Página anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* Next page */}
          <button
            onClick={goToNextPage}
            disabled={!canNextPage || isFetching}
            className={`${buttonBaseClass} ${canNextPage && !isFetching ? buttonEnabledClass : buttonDisabledClass}`}
            aria-label="Ir para próxima página"
            title="Próxima página"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Last page */}
          <button
            onClick={goToLastPage}
            disabled={!canNextPage || isFetching}
            className={`${buttonBaseClass} ${canNextPage && !isFetching ? buttonEnabledClass : buttonDisabledClass}`}
            aria-label="Ir para última página"
            title="Última página"
          >
            <ChevronLast className="w-5 h-5" />
          </button>
        </div>

        {/* Loading indicator (T033) */}
        {isFetching && (
          <output 
            className="ml-2 text-sm text-primary-600 dark:text-primary-400 animate-pulse"
            aria-label="Carregando"
          >
            Carregando...
          </output>
        )}
      </div>
    </div>
  );
};

export default PaginationControls;
