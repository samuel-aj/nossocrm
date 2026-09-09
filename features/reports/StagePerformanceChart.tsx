import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

interface StageConversionData {
  name: string;
  count: number;
  fill: string;
  conversionRate?: number | null; // % that converted to next stage
  populationLabel?: string;
  comparisonBase?: string;
  conversionLabel?: string; // "avançam" or "fecham"
}

interface StageConversionChartProps {
  data: StageConversionData[];
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as StageConversionData;
  return (
    <div
      style={{
        backgroundColor: 'var(--chart-tooltip-bg)',
        border: '1px solid var(--chart-tooltip-border)',
        borderRadius: '12px',
        color: 'var(--chart-tooltip-text)',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        padding: '10px 14px',
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 4 }}>{d.name}</p>
      <p style={{ fontSize: 13 }}>{d.count} negócio{d.count !== 1 ? 's' : ''}</p>
      {d.populationLabel && <p style={{ fontSize: 12, maxWidth: 300 }}>{d.populationLabel}</p>}
      {d.comparisonBase && <p style={{ fontSize: 12 }}>{d.comparisonBase}</p>}
      {d.conversionRate !== undefined && (
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
          {d.conversionRate === null ? '—' : d.conversionRate.toFixed(1) + '%'} {d.conversionLabel || 'avançam'}
        </p>
      )}
    </div>
  );
};

const renderConversionLabel = (props: any) => {
  const { x, y, width, value } = props;
  if (value === undefined) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      fill="var(--chart-text)"
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
    >
      {value === null ? '—' : value.toFixed(0) + '%'}
    </text>
  );
};

const abbreviateStage = (name: string) => {
  const shortened = name.trim()
    .replace(/contato/gi, 'Cont.')
    .replace(/contrato/gi, 'Contr.')
    .replace(/qualificação/gi, 'qualif.')
    .replace(/qualificado/gi, 'Qualif.')
    .replace(/proposta/gi, 'Prop.')
    .replace(/pendente/gi, 'pend.')
    .replace(/assinado/gi, 'ass.')
    .replace(/protocolado/gi, 'Protoc.');
  return shortened.length > 14 ? shortened.slice(0, 13).trimEnd() + '…' : shortened;
};

export const StageConversionChart: React.FC<StageConversionChartProps> = ({ data }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 24, right: 12, bottom: 8, left: 4 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
      <XAxis
        dataKey="name"
        tickFormatter={abbreviateStage}
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--chart-text)', fontSize: 11 }}
        interval="preserveStartEnd"
        height={32}
        angle={0}
        textAnchor="middle"
        dy={6}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
        allowDecimals={false}
      />
      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.5 }} />
      <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
        {data.map((entry, index) => (
          <Cell key={index} fill={entry.fill} />
        ))}
        {data.some(entry => entry.conversionRate !== undefined) ? <LabelList dataKey="conversionRate" content={renderConversionLabel} /> : <LabelList dataKey="count" position="top" fill="var(--chart-text)" fontSize={11} />}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

export default StageConversionChart;
