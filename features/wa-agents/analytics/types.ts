export type BotOutputMetricData = {
  id: string;
  label: string;
  targetStepId: string | null;
  count: number;
  percent: number;
};

export type BotStepMetricData = {
  id: string;
  label: string;
  type: string;
  entered: number;
  percent: number;
  failed: number;
  skipped: number;
  waiting: number;
  outputs: BotOutputMetricData[];
};

export type BotAnalyticsResult = {
  botId: string;
  botUpdatedAt: string;
  asOf: string;
  measurementStartedAt: string | null;
  legacyRuns: number;
  selectedRevision: string | null;
  isCurrentRevision: boolean;
  revisions: Array<{ id: string; startedAt: string; runs: number }>;
  summary: {
    runs: number;
    uniqueSubjects: number;
    running: number;
    waiting: number;
    done: number;
    errored: number;
    cancelled: number;
  };
  steps: BotStepMetricData[];
  groups: Array<{ id: string; label: string; entered: number; percent: number }>;
  variants: Array<{ stepId: string; branchId: string; label: string; subjects: number; converted: number | null; rate: number | null }>;
  goalStepId: string | null;
  goalOptions: Array<{ id: string; label: string }>;
};

export const formatCount = (value: number) => value.toLocaleString('pt-BR');
export const formatRate = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function analyticsDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}
