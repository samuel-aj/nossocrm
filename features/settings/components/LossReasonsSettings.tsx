'use client';

import React, { useEffect, useState } from 'react';
import { ThumbsDown, Plus, X, RotateCcw } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useOrgPreferences } from '@/lib/query/hooks/useOrgPreferences';
import { useToast } from '@/context/ToastContext';
import {
  DEFAULT_QUALIFIED_REASONS,
  DEFAULT_DISQUALIFIED_REASONS,
} from '@/components/ui/LossReasonModal';

const DEFAULT_QUALIFIED = DEFAULT_QUALIFIED_REASONS.map((r) => r.value);
const DEFAULT_DISQUALIFIED = DEFAULT_DISQUALIFIED_REASONS.map((r) => r.value);
// Mesmo limite validado pelo servidor (/api/settings/org).
const MAX_REASONS = 20;

interface ReasonListEditorProps {
  title: string;
  description: string;
  reasons: string[];
  onChange: (next: string[]) => void;
}

function ReasonListEditor({ title, description, reasons, onChange }: ReasonListEditorProps) {
  const [draft, setDraft] = useState('');

  const handleAdd = () => {
    const value = draft.trim();
    if (!value || reasons.length >= MAX_REASONS) return;
    // "Outro" é reservado: o modal sempre acrescenta essa opção sozinho
    // (o servidor também filtra, aqui é só pra não confundir o admin).
    if (value.toLowerCase() === 'outro') {
      setDraft('');
      return;
    }
    if (reasons.some((r) => r.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...reasons, value]);
    setDraft('');
  };

  return (
    <div className="p-4 rounded-xl border bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5">
      <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{description}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {reasons.map((reason) => (
          <div
            key={reason}
            className="flex items-center gap-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 hover:border-red-300 dark:hover:border-red-500/50 transition-colors"
          >
            <span className="text-sm text-slate-900 dark:text-white">{reason}</span>
            <button
              type="button"
              onClick={() => onChange(reasons.filter((r) => r !== reason))}
              className="text-slate-400 hover:text-red-500 p-0.5 rounded transition-colors focus-visible-ring"
              title="Remover motivo"
              aria-label={`Remover ${reason}`}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {reasons.length === 0 && (
          <p className="text-sm text-slate-500 italic">
            Lista vazia volta aos motivos padrão ao salvar.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Novo motivo..."
          maxLength={80}
          className="flex-1 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!draft.trim() || reasons.length >= MAX_REASONS}
          className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> Adicionar
        </button>
      </div>
    </div>
  );
}

/**
 * Motivos de perda personalizados da organização: as opções que aparecem no
 * modal ao marcar um lead como perdido, separadas por tipo (perda de lead
 * qualificado x desqualificação). Sem configuração, valem os padrões.
 */
export function LossReasonsSettings() {
  const { lossReasonsQualified, lossReasonsDisqualified, isLoading, setLossReasons } =
    useOrgPreferences();
  const { addToast } = useToast();

  const [qualified, setQualified] = useState<string[]>(DEFAULT_QUALIFIED);
  const [disqualified, setDisqualified] = useState<string[]>(DEFAULT_DISQUALIFIED);
  // Dirty POR LISTA: salvar envia só o que o admin realmente mexeu, pra não
  // congelar a outra lista como cópia custom dos padrões sem intenção.
  const [dirtyQualified, setDirtyQualified] = useState(false);
  const [dirtyDisqualified, setDirtyDisqualified] = useState(false);
  const dirty = dirtyQualified || dirtyDisqualified;

  // Sincroniza com o servidor enquanto o usuário não editou nada localmente.
  useEffect(() => {
    if (dirtyQualified || dirtyDisqualified) return;
    setQualified(lossReasonsQualified ?? DEFAULT_QUALIFIED);
    setDisqualified(lossReasonsDisqualified ?? DEFAULT_DISQUALIFIED);
  }, [lossReasonsQualified, lossReasonsDisqualified, dirtyQualified, dirtyDisqualified]);

  const usingDefaults = !lossReasonsQualified && !lossReasonsDisqualified;

  const handleSave = () => {
    setLossReasons.mutate(
      {
        qualified: dirtyQualified ? qualified : undefined,
        disqualified: dirtyDisqualified ? disqualified : undefined,
      },
      {
        onSuccess: () => {
          setDirtyQualified(false);
          setDirtyDisqualified(false);
          addToast('Motivos de perda salvos!', 'success');
        },
        onError: (e) => addToast((e as Error).message, 'error'),
      }
    );
  };

  const handleRestore = () => {
    setLossReasons.mutate(
      { qualified: null, disqualified: null },
      {
        onSuccess: () => {
          setQualified(DEFAULT_QUALIFIED);
          setDisqualified(DEFAULT_DISQUALIFIED);
          setDirtyQualified(false);
          setDirtyDisqualified(false);
          addToast('Motivos padrão restaurados.', 'success');
        },
        onError: (e) => addToast((e as Error).message, 'error'),
      }
    );
  };

  return (
    <SettingsSection title="Motivos de perda" icon={ThumbsDown}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
        Personalize as opções que aparecem quando um lead é marcado como{' '}
        <span className="font-semibold">perdido</span>. A opção "Outro" (texto livre) fica sempre
        disponível no modal.
      </p>

      {isLoading ? (
        <p className="text-sm text-slate-500 italic">Carregando motivos...</p>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <ReasonListEditor
              title="Perda (lead qualificado)"
              description="O lead tinha perfil, mas não fechou."
              reasons={qualified}
              onChange={(next) => {
                setQualified(next);
                setDirtyQualified(true);
              }}
            />
            <ReasonListEditor
              title="Desqualificação"
              description="O lead não tinha perfil ou condições."
              reasons={disqualified}
              onChange={(next) => {
                setDisqualified(next);
                setDirtyDisqualified(true);
              }}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || setLossReasons.isPending}
              className="bg-primary-600 hover:bg-primary-500 shadow-primary-600/20 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {setLossReasons.isPending ? 'Salvando...' : 'Salvar motivos'}
            </button>
            {usingDefaults && !dirty ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Usando os motivos padrão do sistema.
              </span>
            ) : (
              <button
                type="button"
                onClick={handleRestore}
                disabled={setLossReasons.isPending}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                <RotateCcw size={14} /> Restaurar padrão
              </button>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}

export default LossReasonsSettings;
