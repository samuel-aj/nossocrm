import type { BoardStage, CustomFieldDefinition, Deal } from '@/types';
import { getDealLeadSource } from './leadSource';

export const NATIVE_STAGE_FIELDS = [
  { id: 'products', label: 'Produto', description: 'Pelo menos um produto ou serviço vinculado' },
  { id: 'leadSource', label: 'Origem do lead', description: 'Uma origem diferente de Não informado' },
  { id: 'ownerId', label: 'Responsável', description: 'Uma pessoa responsável pelo negócio' },
] as const;
export type RequiredStageField = { id: string; label: string; definition?: CustomFieldDefinition; unavailable?: boolean };
export type StageRequirementValues = {
  leadSource?: string;
  ownerId?: string;
  customFields?: Record<string, unknown>;
  product?: { productId: string; price: number; quantity: number };
};
export function isKnownLeadSource(value: unknown): boolean {
  return typeof value === 'string' && !!value.trim() && value.trim().toLocaleLowerCase('pt-BR') !== 'não informado';
}
export function customStageValueFilled(field: CustomFieldDefinition, value: unknown): boolean {
  if (value == null) return false;
  if (field.type === 'multiselect') return Array.isArray(value) && value.length > 0
    && value.every(v => typeof v === 'string' && !!v.trim() && (!field.options?.length || field.options.includes(v)));
  if (!['string', 'number'].includes(typeof value) || !String(value).trim()) return false;
  if (field.type === 'number' || field.type === 'currency') return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value));
  if (field.type === 'date') {
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000')) return false;
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
  }
  if (field.type === 'select') return typeof value === 'string' && (!field.options?.length || field.options.includes(value));
  return typeof value === 'string';
}
export function resolveStageFields(stage: BoardStage, definitions: CustomFieldDefinition[]): RequiredStageField[] {
  return [...new Set(stage.requiredFields ?? [])].map(id => {
    const native = NATIVE_STAGE_FIELDS.find(field => field.id === id);
    if (native) return native;
    const definition = definitions.find(field => `custom:${field.id}` === id);
    return definition ? { id, label: definition.label, definition } : { id, label: 'Campo indisponível', unavailable: true };
  });
}
export function getMissingStageFields(deal: Deal, stage: BoardStage, definitions: CustomFieldDefinition[]): RequiredStageField[] {
  return resolveStageFields(stage, definitions).filter(field => {
    if (field.id === 'products') return !deal.items?.some(item => item.quantity > 0 && item.price >= 0 && !!item.name?.trim());
    if (field.id === 'leadSource') return !isKnownLeadSource(getDealLeadSource(deal));
    if (field.id === 'ownerId') return !deal.ownerId;
    return !field.definition || !customStageValueFilled(field.definition, deal.customFields?.[field.definition.key]);
  });
}
