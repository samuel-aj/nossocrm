'use client';

/**
 * Webhook disparado quando um lead entra na etapa: cria/edita uma regra do
 * pipeline (integration_outbound_endpoints, kind = 'pipeline', evento
 * deal.stage_changed com etapa de destino), a MESMA usada em Configurações →
 * Integrações → Webhooks. O CRM envia um POST em JSON com o negócio e o
 * segredo no cabeçalho; não há método/cabeçalhos/corpo personalizados nessa
 * infraestrutura, então o formulário só pede nome, URL e mostra o segredo.
 */
import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase/client';
import { PIPELINE_RULES_QUERY_KEY, type PipelineRule } from './useStageAutomations';

const INPUT =
  'w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

function generateSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function PipelineWebhookRuleModal({
  open,
  onClose,
  boardId,
  stageId,
  stageLabel,
  rule,
}: {
  open: boolean;
  onClose: () => void;
  boardId: string;
  stageId: string;
  stageLabel: string;
  /** Regra existente (edição); ausente = nova */
  rule?: PipelineRule | null;
}) {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? `Entrou em ${stageLabel}`);
    setUrl(rule?.url ?? '');
    setSecret(rule?.secret ?? generateSecret());
    setCopied(false);
  }, [open, rule, stageLabel]);

  const save = async () => {
    if (!supabase || !profile?.organization_id) return;
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      addToast('Informe uma URL válida (http/https).', 'warning');
      return;
    }
    setSaving(true);
    try {
      const values = {
        name: name.trim() || `Entrou em ${stageLabel}`,
        url: url.trim(),
        events: ['deal.stage_changed'],
        board_id: boardId,
        from_stage_id: null,
        to_stage_id: stageId,
      };
      if (rule) {
        const { error } = await supabase.from('integration_outbound_endpoints').update(values).eq('id', rule.id);
        if (error) throw error;
        addToast('Webhook atualizado.', 'success');
      } else {
        const { error } = await supabase
          .from('integration_outbound_endpoints')
          .insert({ organization_id: profile.organization_id, kind: 'pipeline', secret, active: true, ...values });
        if (error) throw error;
        addToast('Webhook criado. Copie o segredo para validar no seu n8n/Make.', 'success');
      }
      void qc.invalidateQueries({ queryKey: PIPELINE_RULES_QUERY_KEY });
      onClose();
    } catch (e) {
      addToast((e as Error).message || 'Erro ao salvar o webhook', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // sem permissão: o segredo continua visível
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={rule ? 'Editar webhook' : `Webhook ao entrar em ${stageLabel}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Quando um lead entrar nesta etapa, o CRM envia um POST em JSON com os dados do negócio para a URL abaixo.
        </p>
        <div>
          <label htmlFor="pw-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Nome
          </label>
          <input id="pw-name" className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label htmlFor="pw-url" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            URL
          </label>
          <input id="pw-url" type="url" className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." autoFocus />
        </div>
        <div>
          <label htmlFor="pw-secret" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Segredo <span className="font-normal text-slate-400">(vai no cabeçalho X-Webhook-Secret)</span>
          </label>
          <div className="flex items-center gap-2">
            <input id="pw-secret" className={`${INPUT} font-mono text-xs`} value={secret} readOnly />
            <button
              type="button"
              onClick={() => void copySecret()}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
            >
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 focus-visible-ring"
          >
            {saving ? 'Salvando...' : rule ? 'Salvar' : 'Criar webhook'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default PipelineWebhookRuleModal;
