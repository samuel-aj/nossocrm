import React from 'react';
import { FormSelect } from '@/components/ui/FormControls';

export function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[];
}) {
  // Encode values so an empty "all" filter is a selectable Radix item.
  return <div className="min-w-0 flex-1"><FormSelect label={label} value={JSON.stringify(value)}
    onChange={encoded => onChange(JSON.parse(encoded) as string)}
    options={options.map(option => ({ ...option, value: JSON.stringify(option.value) }))} /></div>;
}
