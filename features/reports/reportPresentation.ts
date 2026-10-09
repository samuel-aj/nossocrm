export const REPORT_MODES = {
  monthly: {
    label: 'Resultados no período',
    description: 'Origens e conversão acompanham as entradas do período. Fechamentos incluem todos os ganhos mantidos com encerramento registrado no período, inclusive os de fora dessa base.',
    chartTitle: 'Progressão dos leads no funil',
    chartBasis: 'Entradas do período · ganhos do intervalo',
  },
  conversion: {
    label: 'Resultados no período',
    description: 'Conversão dos mesmos leads que entraram no funil no período, acompanhados até o fim do intervalo.',
    chartTitle: 'Conversão dos leads no funil',
    chartBasis: 'Mesmos leads dos indicadores',
  },
  cohort: {
    label: 'Conversão dos leads captados',
    description: 'Acompanha os mesmos leads, criados no intervalo selecionado, até a data de apuração.',
    chartTitle: 'Etapas com passagem comprovada',
    chartBasis: 'Mesmos leads · histórico até a data de apuração',
  },
  period: {
    label: 'Resultados no período',
    description: 'Conta acontecimentos nas datas selecionadas, incluindo leads captados em meses anteriores.',
    chartTitle: 'Progressão dos leads no funil',
    chartBasis: 'Entradas do período · avanço acumulado',
  },
  current: {
    label: 'Carteira atual',
    description: 'Mostra onde estão os negócios abertos agora, independentemente da data de criação.',
    chartTitle: 'Negócios abertos por etapa',
    chartBasis: 'Posição atual · apenas negócios abertos',
  },
} as const;

export type ReportMode = keyof typeof REPORT_MODES;
export const formatReportRate = (value: number | null | undefined) => value == null ? '—' :
  `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
