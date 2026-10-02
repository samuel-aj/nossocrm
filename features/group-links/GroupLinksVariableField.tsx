"use client";
import { VarField, type VarFieldProps } from '@/features/wa-agents/VarField';
import { WEBHOOK_VARIABLE_GROUPS, withGroupLinkVariables, type VariableGroup } from '@/lib/wa-agents/catalog';
import { useGroupLinksFeature } from './useGroupLinks';

/** Used only by webhook editors, where the server resolves this optional field. */
export function GroupLinksVariableField({ groupsForFeature, ...props }: VarFieldProps & { groupsForFeature?: (enabled: boolean) => VariableGroup[] }) {
  const feature = useGroupLinksFeature();
  return <>
    <VarField {...props} groups={groupsForFeature ? groupsForFeature(feature.enabled) : withGroupLinkVariables(props.groups ?? WEBHOOK_VARIABLE_GROUPS, feature.enabled)} />
    {!feature.enabled && /\{\{\s*deal\.whatsapp_group_id\s*\}\}/.test(props.value) ? <p className="mt-1 text-xs text-amber-600" role="status">O recurso de vínculos de grupos está desativado ou indisponível. Este campo será omitido no envio. O modelo salvo pode continuar sendo editado.</p> : null}
  </>;
}
