'use client';

/**
 * Configurações → CRM: a estrutura dos leads. Campos personalizados (com
 * grupos), tags, motivos de perda e, recolhido, o que é pouco usado (etapa
 * Inativos). Só reorganiza o que já existia em "Geral".
 */
import React from 'react';
import { GroupLinksSettings } from '@/features/group-links/GroupLinksSettings';
import { SlidersHorizontal } from 'lucide-react';
import { Disclosure } from '@/components/ui/Disclosure';
import { CustomFieldsManager } from './components/CustomFieldsManager';
import { TagsManager } from './components/TagsManager';
import { LossReasonsSettings } from './components/LossReasonsSettings';
import { LeadSourceSettings } from './components/LeadSourceSettings';
import { InactiveLeadsSettings } from './components/InactiveLeadsSettings';
import { SettingsCard, SettingsHeader } from './components/SettingsUi';

export const CrmSettings: React.FC = () => {
  return (
    <div className="pb-10 space-y-6">
      <SettingsHeader title="CRM" description="Como os leads são estruturados: origens, campos, tags e motivos de perda." />
      <LeadSourceSettings />
      <p className="text-sm text-slate-500">Origem do lead já é um campo padrão do negócio. Configure suas categorias em <a href="#lead-source-options" className="text-primary-600 underline">Origens do lead</a>. As origens já registradas continuam nos leads.</p>
      <CustomFieldsManager />
      <TagsManager />
      <LossReasonsSettings />
      <GroupLinksSettings />
      <Disclosure label="Configurações avançadas">
        <SettingsCard title="Avançado" description="Opções pouco usadas do funil." icon={SlidersHorizontal}>
          <InactiveLeadsSettings />
        </SettingsCard>
      </Disclosure>
    </div>
  );
};

export default CrmSettings;
