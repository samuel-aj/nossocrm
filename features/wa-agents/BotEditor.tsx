'use client';

/**
 * Editor do robô em quadro visual (React Flow), aberto como uma camada de tela
 * cheia por cima do app (portal em document.body, estilo Typebot): barra superior
 * (voltar, nome, ligado, número que envia, Testar, Salvar), quadro ocupando todo
 * o resto da altura e paleta de passos flutuando sobre o quadro.
 * Salva via POST (novo) ou PATCH (existente) com o payload validado por BotInputSchema.
 */
import '@xyflow/react/dist/style.css';
import './canvas/canvas.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { FocusTrap } from '@/lib/a11y';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { BotInputSchema, type BotInput, type BotRow } from '@/lib/wa-agents/types';
import { DEFAULT_BOT_STEPS } from '@/lib/wa-agents/defaults';
import { useSaveWaBot, useStartWaBot, useWaAgentOptions, useWaAgentsList, type WaAgentListItem } from './useWaAgents';
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

/**
 * Camada do editor. Fica acima do app inteiro (sidebar z-20, cabeçalho z-40) e
 * logo ABAIXO das notificações do ToastContext (z-50), que precisam continuar
 * aparecendo por cima do editor ("Robô salvo", erros de validação). Os modais
 * internos (z-[9999]) vivem dentro deste contexto de empilhamento, portanto
 * também ficam abaixo dos toasts.
 */
const OVERLAY_CLASS =
  'fixed inset-0 z-[49] flex flex-col bg-slate-50 dark:bg-dark-bg text-slate-900 dark:text-white outline-none';

/**
 * Estilo da camada: para em cima da barra de navegação inferior do celular e
 * zera o deslocamento da sidebar que os modais usam (`--app-sidebar-width`),
 * já que aqui a camada cobre a sidebar e os modais devem centralizar na tela.
 */
const OVERLAY_STYLE = {
  bottom: 'var(--app-bottom-nav-height, 0px)',
  '--app-sidebar-width': '0px',
} as React.CSSProperties;

const NAME_INPUT_CLASS =
  'flex-1 min-w-[140px] max-w-md bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-white/10 focus:border-purple-500 focus:bg-white dark:focus:bg-slate-800 rounded-lg px-2 py-1.5 text-base font-semibold text-slate-900 dark:text-white placeholder:font-normal placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-purple-500/20 transition-colors';

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

/** Campo de texto em foco (Esc só tira o foco dele, em vez de fechar o editor). */
function isTextField(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

type PendingSave = { payload: BotInput; warnings: string[] };

/**
 * Esc na camada é tratado pelo próprio editor (listener na janela): o trap de
 * foco recebe um onEscape vazio só para não se desativar com a tecla.
 */
const keepTrapOnEscape = () => {};

/** Referência estável enquanto a lista de agentes não chega (evita re-renderizar os nós a cada tecla). */
const EMPTY_AGENTS: WaAgentListItem[] = [];

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
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Conta os passos adicionados pela paleta para não empilhar todos no mesmo ponto.
  const addedRef = useRef(0);

  const options = optionsQ.data;
  const connections = options?.connections ?? [];
  const agents = agentsQ.data ?? EMPTY_AGENTS;
  const ctx = useMemo<CanvasContextValue>(() => ({ options, agents }), [options, agents]);

  // Enquanto a camada está aberta, a página de trás não rola (o quadro cuida da própria rolagem).
  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  // Foco inicial: robô novo começa pelo nome; robô existente foca a camada (leitores de tela).
  useEffect(() => {
    if (bot) rootRef.current?.focus();
    else nameRef.current?.focus();
  }, [bot]);

  const anyModalOpen = confirmLeave || pending !== null || testOpen;

  const handleCancel = useCallback(() => {
    if (dirty) setConfirmLeave(true);
    else onClose();
  }, [dirty, onClose]);

  // Esc: com um modal aberto, o próprio modal trata; num campo de texto só tira o foco;
  // fora disso pergunta antes de sair (com alterações) ou fecha direto.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || anyModalOpen) return;
      const active = document.activeElement;
      if (isTextField(active)) {
        active.blur();
        return;
      }
      e.preventDefault();
      handleCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, handleCancel]);

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

  // Só existe no navegador (a lista carrega este componente sem SSR).
  if (typeof document === 'undefined') return null;

  // Camada modal: o foco por teclado fica preso nela (a lista de robôs continua
  // montada embaixo, invisível). Cliques fora (ex.: fechar uma notificação) seguem valendo.
  return createPortal(
    <CanvasContext.Provider value={ctx}>
      <FocusTrap active initialFocus={false} onEscape={keepTrapOnEscape} allowOutsideClick>
        <div
          ref={rootRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Editor do robô ${header.name || 'novo'}`}
          tabIndex={-1}
          className={OVERLAY_CLASS}
          style={OVERLAY_STYLE}
        >
          <header className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 min-h-14 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-sm">
            <button
              type="button"
              className={BTN_ICON}
              onClick={handleCancel}
              aria-label="Voltar para a lista de robôs"
              title="Voltar (Esc)"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <input
              ref={nameRef}
              id="bot-name"
              className={NAME_INPUT_CLASS}
              value={header.name}
              onChange={(e) => patchHeader({ name: e.target.value })}
              maxLength={120}
              placeholder="Nome do robô"
              aria-label="Nome do robô"
            />
            <div className="flex items-center gap-2 pl-1">
              <span className="text-sm text-slate-600 dark:text-slate-300">{header.enabled ? 'Ligado' : 'Desligado'}</span>
              <Toggle checked={header.enabled} onChange={(enabled) => patchHeader({ enabled })} label="Robô ligado" />
            </div>
            <select
              id="bot-connection"
              className={`${INPUT_CLASS} w-auto min-w-[160px] max-w-[260px]`}
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
            <div className="flex items-center gap-2 ml-auto">
              {dirty ? (
                <span className="hidden sm:inline text-xs font-medium text-amber-600 dark:text-amber-400">Não salvo</span>
              ) : null}
              <button type="button" className={BTN_SECONDARY} onClick={openTest} disabled={save.isPending}>
                <Play size={16} aria-hidden="true" />
                Testar
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
          </header>

          {optionsQ.error ? (
            <div className="shrink-0 px-3 pt-3">
              <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice>
            </div>
          ) : null}

          <div ref={canvasRef} className="relative flex-1 min-h-0">
            <Palette onAdd={addStep} />
            <BotCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDropStep={addStep}
              darkMode={darkMode}
            />
          </div>

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
      </FocusTrap>
    </CanvasContext.Provider>,
    document.body
  );
};

/**
 * Componente React `BotEditor`: camada de tela cheia com o quadro do robô.
 * Renderiza num portal em document.body, por isso pode ficar montado ao lado da
 * lista de robôs (a lista continua embaixo e reaparece ao fechar).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BotEditor: React.FC<{ bot: BotRow | null; onClose: () => void }> = ({ bot, onClose }) => (
  <ReactFlowProvider>
    <BotEditorInner bot={bot} onClose={onClose} />
  </ReactFlowProvider>
);

export default BotEditor;
