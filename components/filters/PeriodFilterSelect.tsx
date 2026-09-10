import { FilterSelect } from './FilterSelect';
import React from 'react';
import { PeriodFilter, PERIOD_LABELS } from '@/features/dashboard/hooks/useDashboardMetrics';

interface PeriodFilterSelectProps {
    value: PeriodFilter;
    onChange: (period: PeriodFilter) => void;
    className?: string;
    'aria-label'?: string;
}

/**
 * Componente de seleção de período compartilhado.
 * Usado em Dashboard, Reports e outras páginas que precisam filtrar por período.
 */
export const PeriodFilterSelect: React.FC<PeriodFilterSelectProps> = ({
    value,
    onChange,
    className = '',
    'aria-label': ariaLabel = 'Selecionar Período',
}) => {
    return (
        <div className={className || 'min-w-[160px] flex-1'}><FilterSelect label={ariaLabel} value={value} onChange={period => onChange(period as PeriodFilter)} options={Object.entries(PERIOD_LABELS).map(([value,label]) => ({value,label}))} /></div>
    );
};

export default PeriodFilterSelect;
