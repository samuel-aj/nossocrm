import React, { useMemo, useState, useId } from 'react';
import { X, Plus, GripVertical, Trash2, ChevronDown, Settings } from 'lucide-react';
import { Board, BoardStage, ContactStage } from '@/types';
import { BOARD_TEMPLATES, BoardTemplateType } from '@/board-templates';
import { LifecycleSettingsModal } from '@/features/settings/components/LifecycleSettingsModal';
import { useCRM } from '@/context/CRMContext';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

interface CreateBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (board: Omit<Board, 'id' | 'createdAt'>) => void;
  editingBoard?: Board; // Se fornecido, estamos editando
  availableBoards: Board[]; // Para selecionar o próximo board
}

const STAGE_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
];


export const CreateBoardModal: React.FC<CreateBoardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingBoard,
  availableBoards
}) => {
  const headingId = useId();
  useFocusReturn({ enabled: isOpen });

  const { lifecycleStages } = useCRM();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nextBoardId, setNextBoardId] = useState<string>('');
  const [linkedLifecycleStage, setLinkedLifecycleStage] = useState<string>('');
  const [wonStageId, setWonStageId] = useState<string>('');
  const [lostStageId, setLostStageId] = useState<string>('');
  const [wonStayInStage, setWonStayInStage] = useState(false);
  const [lostStayInStage, setLostStayInStage] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BoardTemplateType | ''>('');
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [isLifecycleModalOpen, setIsLifecycleModalOpen] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      if (editingBoard) {
        setName(editingBoard.name);
        setDescription(editingBoard.description || '');
        setNextBoardId(editingBoard.nextBoardId || '');
        setLinkedLifecycleStage(editingBoard.linkedLifecycleStage || '');
        setWonStageId(editingBoard.wonStageId || '');
        setLostStageId(editingBoard.lostStageId || '');
        setWonStayInStage(editingBoard.wonStayInStage || false);
        setLostStayInStage(editingBoard.lostStayInStage || false);
        setSelectedTemplate(editingBoard.template || '');
        setStages(editingBoard.stages);
      } else {
        // Reset for new board
        setName('');
        setDescription('');
        setNextBoardId('');
        setLinkedLifecycleStage('');
        setWonStageId('');
        setLostStageId('');
        setWonStayInStage(false);
        setLostStayInStage(false);
        setSelectedTemplate('');
        setStages([
          { id: crypto.randomUUID(), label: 'Nova', color: 'bg-blue-500' },
          { id: crypto.randomUUID(), label: 'Em Progresso', color: 'bg-yellow-500' },
          { id: crypto.randomUUID(), label: 'Concluído', color: 'bg-green-500' },
        ]);
      }
    }
  }, [isOpen, editingBoard]);

  // Filter out current board to prevent self-reference
  // Performance: avoid filtering on every render.
  const validNextBoards = useMemo(
    () => availableBoards.filter(b => b.id !== editingBoard?.id),
    [availableBoards, editingBoard?.id]
  );

  const handleAddStage = () => {
    const colorIndex = stages.length % STAGE_COLORS.length;
    setStages([...stages, {
      id: crypto.randomUUID(),
      label: `Etapa ${stages.length + 1}`,
      color: STAGE_COLORS[colorIndex]
    }]);
  };

  const handleRemoveStage = (id: string) => {
    if (stages.length > 2) {
      setStages(stages.filter(s => s.id !== id));
    }
  };

  const handleUpdateStage = (id: string, updates: Partial<BoardStage>) => {
    setStages(stages.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleTemplateSelect = (template: BoardTemplateType | '') => {
    setSelectedTemplate(template);

    if (template && BOARD_TEMPLATES[template]) {
      const templateData = BOARD_TEMPLATES[template];
      setName(templateData.name);
      setDescription(templateData.description);
      setLinkedLifecycleStage(templateData.linkedLifecycleStage || '');
      // Templates don't pre-define won/lost stage IDs because staged IDs are generated
      // But we could try to guess based on label? For now, leave empty.
      setStages(templateData.stages.map((s, idx) => ({
        id: crypto.randomUUID(),
        ...s
      })));
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      nextBoardId: (nextBoardId || null) as any,
      linkedLifecycleStage: (linkedLifecycleStage || null) as any,
      wonStageId: (wonStageId || null) as any,
      lostStageId: (lostStageId || null) as any,
      wonStayInStage,
      lostStayInStage,
      template: selectedTemplate || 'CUSTOM',
      stages,
      isDefault: false
    });

    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <FocusTrap active={isOpen && !isLifecycleModalOpen} onEscape={onClose}>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

          <div className="relative z-10 w-full max-w-2xl bg-white dark:bg-dark-card rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-white/10">
              <h2 id={headingId} className="text-xl font-bold text-slate-900 dark:text-white">
                {editingBoard ? 'Editar Board' : 'Criar Novo Board'}
              </h2>
              <button
                onClick={onClose}
                aria-label="Fechar modal"
                className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors focus-visible-ring"
              >
                <X size={20} className="text-slate-500" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Nome do Board *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Pipeline de Vendas, Onboarding, etc"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Descrição
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Breve descrição do propósito deste board"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Template Selection (only for new boards) */}
              {!editingBoard && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    📋 Usar Template
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateSelect(e.target.value as BoardTemplateType | '')}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Board em branco</option>
                    <option value="PRE_SALES">🎯 Pré-venda (Lead → MQL)</option>
                    <option value="SALES">💰 Pipeline de Vendas</option>
                    <option value="ONBOARDING">🚀 Onboarding de Clientes</option>
                    <option value="CS">❤️ CS & Upsell</option>
                  </select>
                  {selectedTemplate && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      ✨ Template aplicado! Você pode editar os campos abaixo.
                    </p>
                  )}
                </div>
              )}

              {/* Linked Lifecycle Stage */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  🎯 Gerencia Contatos no Estágio
                </label>
                <select
                  value={linkedLifecycleStage}
                  onChange={(e) => setLinkedLifecycleStage(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Nenhum (board genérico)</option>
                  {lifecycleStages.map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.name}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Novos negócios de contatos neste estágio aparecerão automaticamente aqui.
                </p>
              </div>

              {/* Next Board Automation */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Ao Ganhar, enviar para...
                </label>
                <select
                  value={nextBoardId}
                  onChange={(e) => setNextBoardId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Nenhum (Finalizar aqui)</option>
                  {validNextBoards.map(board => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Cria automaticamente um card no próximo board quando o negócio é ganho.
                </p>
              </div>

              {/* Explicit Won/Lost Stages */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    🏆 Estágio Ganho (Won)
                  </label>
                  <select
                    value={wonStayInStage ? 'archive' : wonStageId}
                    onChange={(e) => {
                      if (e.target.value === 'archive') {
                        setWonStayInStage(true);
                        setWonStageId('');
                      } else {
                        setWonStayInStage(false);
                        setWonStageId(e.target.value);
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Automático (pelo ciclo)</option>
                    <option value="archive">Arquivar (Manter na etapa)</option>
                    {stages.map(stage => (
                      <option key={stage.id} value={stage.id}>{stage.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    O botão "Ganho" moverá o card para cá.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    ❌ Estágio Perdido (Lost)
                  </label>
                  <select
                    value={lostStayInStage ? 'archive' : lostStageId}
                    onChange={(e) => {
                      if (e.target.value === 'archive') {
                        setLostStayInStage(true);
                        setLostStageId('');
                      } else {
                        setLostStayInStage(false);
                        setLostStageId(e.target.value);
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Automático</option>
                    <option value="archive">Arquivar (Manter na etapa)</option>
                    {stages.map(stage => (
                      <option key={stage.id} value={stage.id}>{stage.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    O botão "Perdido" moverá o card para cá.
                  </p>
                </div>
              </div>

              {/* Stages */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Etapas do Kanban
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAddStage}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
                    >
                      <Plus size={14} />
                      Adicionar etapa
                    </button>
                    <button
                      onClick={() => setIsLifecycleModalOpen(true)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <Settings size={14} />
                      Gerenciar Estágios
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {stages.map((stage, index) => (
                    <div
                      key={stage.id}
                      className="p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-colors"
                    >
                      {/* Stage Header */}
                      <div className="flex items-center gap-3 mb-3">
                        <GripVertical size={18} className="text-slate-400 cursor-grab flex-shrink-0" />

                        {/* Color Picker */}
                        <div className="relative flex-shrink-0">
                          <div className={`w-5 h-5 rounded-full ${stage.color} cursor-pointer ring-2 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600 transition-all`} />
                          <select
                            value={stage.color}
                            onChange={(e) => handleUpdateStage(stage.id, { color: e.target.value })}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          >
                            {STAGE_COLORS.map(color => (
                              <option key={color} value={color}>{color.replace('bg-', '').replace('-500', '')}</option>
                            ))}
                          </select>
                        </div>

                        {/* Label */}
                        <input
                          type="text"
                          value={stage.label}
                          onChange={(e) => handleUpdateStage(stage.id, { label: e.target.value })}
                          className="flex-1 px-3 py-2 text-base font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="Nome da etapa"
                        />

                        {/* Delete */}
                        <button
                          onClick={() => handleRemoveStage(stage.id)}
                          disabled={stages.length <= 2}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
                          title="Remover etapa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      {/* Lifecycle Automation */}
                      <div className="pl-9">
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                          Promove contato para:
                        </label>
                        <div className="relative">
                          <select
                            value={stage.linkedLifecycleStage || ''}
                            onChange={(e) => handleUpdateStage(stage.id, { linkedLifecycleStage: e.target.value || undefined })}
                            className={`w-full pl-3 pr-10 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all appearance-none cursor-pointer
                            ${stage.linkedLifecycleStage ? 'font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700' : ''}
                          `}
                          >
                            <option value="">Sem automação</option>
                            {lifecycleStages.map(ls => (
                              <option key={ls.id} value={ls.id}>{ls.name}</option>
                            ))}
                          </select>
                          <ChevronDown
                            size={16}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors focus-visible-ring"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors focus-visible-ring"
              >
                {editingBoard ? 'Salvar Alterações' : 'Criar Board'}
              </button>
            </div>
          </div>
        </div>
      </FocusTrap>

      <LifecycleSettingsModal
        isOpen={isLifecycleModalOpen}
        onClose={() => setIsLifecycleModalOpen(false)}
      />
    </>
  );
};
