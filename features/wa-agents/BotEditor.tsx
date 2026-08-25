'use client';

/**
 * Editor do robô em quadro visual (React Flow): cabeçalho (nome, ligado, número
 * que envia, Salvar / Cancelar / Testar), paleta de passos e o quadro com os nós.
 * Salva via POST (novo) ou PATCH (existente) com o payload validado por BotInputSchema.
 */
import '@xyflow/react/dist/style.css';
import './canvas/canvas.css';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { ArrowLeft, Loader2, Play, Save } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { BotInputSchema, type BotInput, type BotRow } from '@/lib/wa-agents/types';
import { DEFAULT_BOT_STEPS } from '@/lib/wa-agents/defaults';
import { useSaveWaBot, useStartWaBot, useWaAgentOptions, useWaAgentsList } from './useWaAgents';
import {
  BTN_ICON,
  BTN_PRIMARY,
  BTN_SECONDARY,
  Field,
  INPUT_CLASS,
  Notice,
  Toggle,
  describeZodIssue,
  errorMessage,
} from './ui';
import { BotCanvas } from './canvas/BotCanvas';
import { Palette } from './canvas/Palette';
import { CanvasContext, type CanvasContextValue } from './canvas/context';
import { botToFlow, createStepNode, flowToBot, validateFlow } from './canvas/serialize';
import {
  HANDLE_IN,
  NODE_WIDTH,
  edgeIdFor,
  type FlowEdge,
  type FlowHeader,
  type FlowNode,
  type StepType,
} from './canvas/types';

export { STEP_LABELS, TRIGGER_LABELS } from './canvas/types';

const FIELD_NAMES: Record<string, string> = {
  name: 'Nome',
  connection_id: 'Número',
  trigger: 'Gatilho',
  steps: 'Passos',
  start_step_id: 'Primeiro passo',
};

/** Mensagem em pt-BR para um problema do zod, pelo caminho do campo. */
function describeIssue(path: PropertyKey[], message: string): string {
  const root = String(path[0] ?? '');
  const label = FIELD_NAMES[root] ?? root;
  if (root === 'steps' && typeof path[1] === 'number') {
    const rest = path.slice(2).map(String).join('.');
    return `Passo ${path[1] + 1}${rest ? ` (${rest})` : ''}: ${message}`;
  }
  const rest = path.slice(1).map(String).join('.');
  return `${label}${rest ? ` (${rest})` : ''}: ${message}`;
}

type PendingSave = { payload: BotInput; warnings: string[] };

const BotEditorInner: React.FC<{ bot: BotRow | null; onClose: () => void }> = ({ bot, onClose }) => {
  const { showToast } = useToast();
  const { darkMode } = useTheme();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const save = useSaveWaBot();
  const start = useStartWaBot();
  const flow = useReactFlow<FlowNode, FlowEdge>();

  const initial = useMemo(() => botToFlow(bot, DEFAULT_BOT_STEPS), [bot]);
  const [nodes, setNodes, handleNodeChanges] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, handleEdgeChanges] = useEdgesState<FlowEdge>(initial.edges);
  const [header, setHeader] = useState<FlowHeader>({
    name: bot?.name ?? '',
    enabled: bot?.enabled ?? true,
    connection_id: bot?.connection_id ?? '',
  });
  const [botId, setBotId] = useState<string | null>(bot?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  // Conta os passos adicionados pela paleta para não empilhar todos no mesmo ponto.
  const addedRef = useRef(0);

  const options = optionsQ.data;
  const connections = options?.connections ?? [];
  const ctx = useMemo<CanvasContextValue>(() => ({ options, agents: agentsQ.data ?? [] }), [options, agentsQ.data]);

  const patchHeader = (patch: Partial<FlowHeader>) => {
    setHeader((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true);
      handleNodeChanges(changes);
    },
    [handleNodeChanges]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (changes.some((c) => c.type !== 'select')) setDirty(true);
      handleEdgeChanges(changes);
    },
    [handleEdgeChanges]
  );

  // Uma aresta por handle de saída: ligar de novo substitui a anterior.
  const onConnect = useCallback(
    (c: Connection) => {
      const sourceHandle = c.sourceHandle;
      if (!sourceHandle || c.source === c.target) return;
      setEdges((eds) => [
        ...eds.filter((e) => !(e.source === c.source && e.sourceHandle === sourceHandle)),
        {
          id: edgeIdFor(c.source, sourceHandle),
          source: c.source,
          sourceHandle,
          target: c.target,
          targetHandle: c.targetHandle ?? HANDLE_IN,
        },
      ]);
      setDirty(true);
    },
    [setEdges]
  );

  /** Posição perto do centro da área visível, com um pequeno deslocamento a cada adição. */
  const viewportCenter = useCallback((): XYPosition => {
    const jitter = (addedRef.current % 6) * 24;
    addedRef.current += 1;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: jitter, y: jitter };
    const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: Math.round(center.x - NODE_WIDTH / 2 + jitter), y: Math.round(center.y - 40 + jitter) };
  }, [flow]);

  const addStep = useCallback(
    (type: StepType, position?: XYPosition) => {
      const node = createStepNode(type, position ?? viewportCenter());
      setNodes((nds) => [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }]);
      setDirty(true);
    },
    [setNodes, viewportCenter]
  );

  /** Seleciona e enquadra um nó (usado para apontar o problema de validação). */
  const focusNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      void flow.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 0.4 });
    },
    [flow, setNodes]
  );

  const persist = async (payload: BotInput) => {
    try {
      const saved = await save.mutateAsync({ id: botId, input: payload });
      setBotId(saved.id);
      setDirty(false);
      showToast(botId ? 'Robô salvo' : 'Robô criado', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao salvar o robô'), 'error');
    }
  };

  const handleSave = () => {
    const { errors, warnings } = validateFlow(nodes, edges, header);
    if (errors.length > 0) {
      const first = errors[0];
      showToast(errors.length > 1 ? `${first.message} (+${errors.length - 1})` : first.message, 'error');
      if (first.nodeId) focusNode(first.nodeId);
      return;
    }
    const parsed = BotInputSchema.safeParse(flowToBot(nodes, edges, header));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      showToast(issue ? describeIssue(issue.path, describeZodIssue(issue)) : 'Dados inválidos', 'error');
      return;
    }
    if (warnings.length > 0) {
      setPending({ payload: parsed.data, warnings: warnings.map((w) => w.message) });
      if (warnings[0].nodeId) focusNode(warnings[0].nodeId);
      return;
    }
    void persist(parsed.data);
  };

  const handleCancel = () => {
    if (dirty) setConfirmLeave(true);
    else onClose();
  };

  const openTest = () => {
    if (!botId) {
      showToast('Salve o robô antes de testar', 'info');
      return;
    }
    if (dirty) {
      showToast('Salve as alterações antes de testar', 'info');
      return;
    }
    setTestPhone('');
    setTestOpen(true);
  };

  const handleStart = async () => {
    if (!botId) return;
    const phone = testPhone.trim();
    if (!phone) {
      showToast('Informe o telefone com DDD', 'error');
      return;
    }
    try {
      const result = await start.mutateAsync({ id: botId, phone });
      if (result.ok === false) throw new Error(result.error || 'Falha ao iniciar o robô');
      showToast('Robô iniciado. Acompanhe em Execuções.', 'success');
      setTestOpen(false);
      setTestPhone('');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao iniciar o robô'), 'error');
    }
  };

  const connectionLabel = connections.find((c) => c.id === header.connection_id)?.label ?? 'número escolhido';

  return (
    <CanvasContext.Provider value={ctx}>
      <div className="space-y-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BTN_ICON}
            onClick={handleCancel}
            aria-label="Voltar para a lista de robôs"
            title="Voltar"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <input
            id="bot-name"
            className={`${INPUT_CLASS} flex-1 min-w-[180px] font-semibold`}
            value={header.name}
            onChange={(e) => patchHeader({ name: e.target.value })}
            maxLength={120}
            placeholder="Nome do robô"
            aria-label="Nome do robô"
          />
          <select
            id="bot-connection"
            className={`${INPUT_CLASS} w-auto min-w-[200px] max-w-xs`}
            value={header.connection_id}
            onChange={(e) => patchHeader({ connection_id: e.target.value })}
            aria-label="Número que envia as mensagens"
          >
            <option value="">Número que envia...</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.status === 'connected' ? '' : ' (desconectado)'}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-300">{header.enabled ? 'Ligado' : 'Desligado'}</span>
            <Toggle checked={header.enabled} onChange={(enabled) => patchHeader({ enabled })} label="Robô ligado" />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {dirty ? (
              <span className="hidden sm:inline text-xs font-medium text-amber-600 dark:text-amber-400">Não salvo</span>
            ) : null}
            <button type="button" className={BTN_SECONDARY} onClick={openTest} disabled={save.isPending}>
              <Play size={16} aria-hidden="true" />
              Testar
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={handleCancel} disabled={save.isPending}>
              Cancelar
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={16} aria-hidden="true" />
              )}
              Salvar
            </button>
          </div>
        </div>

        {optionsQ.error ? <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice> : null}

        <div className="flex flex-col md:flex-row gap-3 md:h-[calc(100vh-230px)] md:min-h-[560px]">
          <Palette onAdd={(type) => addStep(type)} />
          <div ref={canvasRef} className="relative flex-1 min-h-[560px]">
            <BotCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDropStep={(type, position) => addStep(type, position)}
              darkMode={darkMode}
            />
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Arraste os passos pelo título. Ligue uma saída (bolinha à direita) à entrada de outro passo (bolinha à
          esquerda). Cada saída aceita uma ligação: ligar de novo substitui a anterior. A saída "Então" do gatilho define
          o primeiro passo.
        </p>

        <ConfirmModal
          isOpen={confirmLeave}
          onClose={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            onClose();
          }}
          title="Descartar alterações"
          message="Há alterações não salvas neste robô. Sair sem salvar?"
          confirmText="Sair sem salvar"
          variant="danger"
        />

        <ConfirmModal
          isOpen={!!pending}
          onClose={() => setPending(null)}
          onConfirm={() => {
            const p = pending;
            setPending(null);
            if (p) void persist(p.payload);
          }}
          title="Salvar mesmo assim?"
          message={
            <ul className="list-disc pl-5 space-y-1">
              {(pending?.warnings ?? []).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          }
          confirmText="Salvar mesmo assim"
          variant="primary"
        />

        <Modal
          isOpen={testOpen}
          onClose={() => setTestOpen(false)}
          title={`Testar: ${header.name || 'robô'}`}
          size="md"
          initialFocus="#bot-test-phone"
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleStart();
            }}
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">
              O robô vai enviar as mensagens de verdade para este telefone pelo número <strong>{connectionLabel}</strong>.
              Use um número seu para testar.
            </p>
            <Field label="Telefone com DDD" htmlFor="bot-test-phone" help="Ex.: (11) 99999-9999 ou +5511999999999">
              <input
                id="bot-test-phone"
                type="tel"
                className={INPUT_CLASS}
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+55 11 99999-9999"
                autoComplete="off"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setTestOpen(false)} disabled={start.isPending}>
                Cancelar
              </button>
              <button type="submit" className={BTN_PRIMARY} disabled={start.isPending || !testPhone.trim()}>
                {start.isPending ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Play size={16} aria-hidden="true" />
                )}
                Iniciar robô
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </CanvasContext.Provider>
  );
};

/**
 * Componente React `BotEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BotEditor: React.FC<{ bot: BotRow | null; onClose: () => void }> = ({ bot, onClose }) => (
  <ReactFlowProvider>
    <BotEditorInner bot={bot} onClose={onClose} />
  </ReactFlowProvider>
);

export default BotEditor;
