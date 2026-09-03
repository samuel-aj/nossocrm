'use client';

/**
 * Campo de texto COM VARIÁVEIS, reutilizado por todos os campos de texto das
 * ações (nota, tarefa, rótulo, motivo de perda, descrição, corpo do webhook).
 *
 * - Variáveis do sistema ({{nome_lead}}, {{campos.chave}}...) e variáveis
 *   PREENCHIDAS PELA IA ({{ia:nome}}) aparecem destacadas no texto (chips de
 *   cor, azul e rosa), com a mesma camada espelho do roteiro.
 * - Digitar `{` abre o autocomplete; continuar digitando filtra a lista. O
 *   botão "Inserir variável" abre o mesmo menu, com busca.
 * - "+ Criar variável preenchida pela IA" abre o balão de nome + instrução.
 * - Clicar numa variável de IA já escrita abre o balão para editar/excluir.
 *
 * Menu e balão são camadas flutuantes num portal (FloatingLayer): nunca ficam
 * cortados pelo modal e viram para cima quando não há espaço embaixo.
 * O campo cresce sozinho conforme o texto (auto-resize), sem alça manual.
 *
 * As definições das variáveis de IA são DO AGENTE (agent.ai_vars): a mesma
 * variável pode ser usada em várias ações e a instrução é uma só.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Braces, Search, Sparkles, Trash2 } from 'lucide-react';
import { FloatingLayer } from '@/components/ui/FloatingLayer';
import {
  ACTION_TEXT_VARIABLE_GROUPS,
  promptVariableName,
  type VariableGroup,
  type VariableOption,
} from '@/lib/wa-agents/catalog';
import { aiVarToken } from '@/lib/wa-agents/template';
import { AI_VAR_NAME_RE, MAX_AI_VARS_PER_AGENT, type AgentAiVar } from '@/lib/wa-agents/types';
import { HighlightedScript } from './HighlightedScript';
import { insertToken } from './PromptEditor';
import { splitPromptTokens, type KnownTokens } from './tokens';
import { BTN_SMALL, HELP_CLASS, INPUT_CLASS, TEXTAREA_CLASS } from './ui';

export type VarFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  /** 1 = uma linha lógica (Enter vira espaço; a altura ainda cresce com o texto); mais = área de texto */
  rows?: number;
  /** Altura inicial em linhas (o campo cresce a partir daí) */
  minRows?: number;
  /** Variáveis de IA do agente e como alterá-las (compartilhadas entre as ações) */
  aiVars: AgentAiVar[];
  onAiVarsChange: (vars: AgentAiVar[]) => void;
  /** Variáveis extras deste campo (ex.: as do payload do webhook) */
  extraVars?: Array<{ key: string; description: string }>;
  /** Grupos de variáveis do menu (substitui os grupos padrão das ações) */
  groups?: VariableGroup[];
  /** Texto do botão de inserir ("Inserir variável"); sem texto, só o ícone */
  insertLabel?: string;
};

type MenuState = { open: boolean; triggerPos: number | null };
type PopoverState =
  | { mode: 'closed' }
  | { mode: 'create'; insertAt: number | null }
  | { mode: 'edit'; name: string };

const MENU_ITEM_CLASS =
  'w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200';

/** Nome saneado para variável de IA: minúsculas, sem acento, `_`. */
function slugAiName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export const VarField: React.FC<VarFieldProps> = ({
  id,
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength,
  rows = 1,
  minRows,
  aiVars,
  onAiVarsChange,
  extraVars,
  groups,
  insertLabel,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [menu, setMenu] = useState<MenuState>({ open: false, triggerPos: null });
  const [popover, setPopover] = useState<PopoverState>({ mode: 'closed' });
  const [draft, setDraft] = useState<AgentAiVar>({ name: '', instruction: '', example: '' });
  const [draftError, setDraftError] = useState<string | null>(null);
  /** Busca digitada no menu aberto pelo botão (o menu do `{` filtra pelo texto do campo) */
  const [busca, setBusca] = useState('');
  const singleLine = rows === 1;
  const visibleRows = minRows ?? (singleLine ? 2 : rows);

  const varGroups: VariableGroup[] = useMemo(() => {
    const base = groups ?? ACTION_TEXT_VARIABLE_GROUPS;
    if (!extraVars || extraVars.length === 0) return base;
    return [...base, { label: 'Outras', vars: extraVars }];
  }, [groups, extraVars]);
  const systemVars: VariableOption[] = useMemo(() => varGroups.flatMap(g => g.vars), [varGroups]);
  const known: KnownTokens = useMemo(
    () => ({
      vars: systemVars.map(v => promptVariableName(v.key)),
      varPrefixes: ['campos.', 'deal.custom_fields.'],
      aiVars: aiVars.map(v => v.name),
      actions: [],
      media: [],
      mediaLoaded: true,
    }),
    [systemVars, aiVars]
  );

  // Filtro do autocomplete: a sequência de caracteres de nome logo depois do
  // `{` que abriu o menu (sem ler o cursor durante o render).
  const filtro = useMemo(() => {
    if (!menu.open) return '';
    if (menu.triggerPos === null) return busca.trim().toLowerCase();
    const resto = value.slice(menu.triggerPos + 1);
    const m = /^[a-zA-Z0-9_.:{]*/.exec(resto)?.[0] ?? '';
    return m.replace(/^\{+/, '').toLowerCase();
  }, [menu, value, busca]);

  const casa = (v: VariableOption) =>
    !filtro || v.key.toLowerCase().includes(filtro) || v.description.toLowerCase().includes(filtro);
  const gruposFiltrados = varGroups.map(g => ({ ...g, vars: g.vars.filter(casa) })).filter(g => g.vars.length > 0);
  const filtroIa = filtro.replace(/^ia:?/, '');
  const iaFiltradas = aiVars.filter(v => !filtro || v.name.includes(filtroIa) || `ia:${v.name}`.includes(filtro));
  const nadaEncontrado = gruposFiltrados.length === 0 && iaFiltradas.length === 0;

  const fecharMenu = () => {
    setMenu({ open: false, triggerPos: null });
    setBusca('');
  };
  const abrirMenuPeloBotao = () => {
    setMenu({ open: true, triggerPos: null });
    // Foco na busca DEPOIS de a camada avisar o modal (foco preso pausado)
    window.setTimeout(() => searchRef.current?.focus(), 30);
  };

  const limpar = (text: string) => (singleLine ? text.replace(/\n+/g, ' ') : text);

  /** Insere um token: substitui `{`+filtro digitados (quando o menu veio do teclado) ou entra no cursor. */
  const inserir = (token: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    let start = caret;
    let end = caret;
    if (menu.triggerPos !== null && menu.triggerPos < caret) {
      start = menu.triggerPos;
      end = caret;
    } else if (el) {
      start = el.selectionStart ?? caret;
      end = el.selectionEnd ?? caret;
    }
    const { next, caret: pos } = insertToken(value, token, start, end);
    onChange(limpar(next));
    fecharMenu();
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  /** Digitou `{`: abre o menu lembrando a posição; o resto fecha ou vira filtro. */
  const handleChange = (next: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? next.length;
    const limpo = limpar(next);
    onChange(limpo);
    if (limpo.length === value.length + 1 && limpo[caret - 1] === '{') {
      setMenu({ open: true, triggerPos: caret - 1 });
      return;
    }
    if (menu.open && menu.triggerPos !== null) {
      const trecho = limpo.slice(menu.triggerPos, caret);
      if (!trecho.startsWith('{') || /[^a-zA-Z0-9_.:{]/.test(trecho.slice(1))) fecharMenu();
    }
  };

  /** Clique/tecla no texto: caret dentro de um {{ia:...}} abre a edição da variável. */
  const abrirEdicaoNoCaret = () => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    let pos = 0;
    for (const part of splitPromptTokens(value, known)) {
      const fim = pos + part.text.length;
      if (part.kind === 'iavar' && caret > pos && caret < fim) {
        const nome = part.name.toLowerCase();
        const existente = aiVars.find(v => v.name === nome);
        setDraft(existente ?? { name: nome, instruction: '', example: '' });
        setDraftError(null);
        setPopover({ mode: 'edit', name: nome });
        return;
      }
      pos = fim;
    }
  };

  const abrirCriacao = (insertAt: number | null) => {
    setDraft({ name: '', instruction: '', example: '' });
    setDraftError(null);
    setPopover({ mode: 'create', insertAt });
    fecharMenu();
  };

  const salvarPopover = () => {
    const nome = slugAiName(draft.name);
    const instrucao = draft.instruction.trim();
    if (!nome || !AI_VAR_NAME_RE.test(nome)) {
      setDraftError('Dê um nome: letras minúsculas, números e _ (até 40).');
      return;
    }
    if (!instrucao) {
      setDraftError('Escreva a instrução: o que a IA deve preencher.');
      return;
    }
    const limpa: AgentAiVar = { name: nome, instruction: instrucao, example: draft.example.trim() };
    if (popover.mode === 'create') {
      if (aiVars.some(v => v.name === nome)) {
        setDraftError(`Já existe a variável "${nome}". Clique nela no texto para editar.`);
        return;
      }
      if (aiVars.length >= MAX_AI_VARS_PER_AGENT) {
        setDraftError(`Limite de ${MAX_AI_VARS_PER_AGENT} variáveis de IA por agente.`);
        return;
      }
      onAiVarsChange([...aiVars, limpa]);
      const el = textareaRef.current;
      const caret = popover.insertAt ?? el?.selectionStart ?? value.length;
      const { next, caret: pos } = insertToken(value, aiVarToken(nome), caret, el?.selectionEnd ?? caret);
      onChange(limpar(next));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    } else if (popover.mode === 'edit') {
      const anterior = popover.name;
      const outras = aiVars.filter(v => v.name !== anterior);
      if (nome !== anterior && outras.some(v => v.name === nome)) {
        setDraftError(`Já existe a variável "${nome}".`);
        return;
      }
      onAiVarsChange([...outras, limpa]);
      if (nome !== anterior) {
        // Renomeada: os usos NESTE campo acompanham (os de outros campos ficam
        // em âmbar até serem trocados, o destaque avisa)
        onChange(value.split(aiVarToken(anterior)).join(aiVarToken(nome)));
      }
    }
    setPopover({ mode: 'closed' });
  };

  const excluirVariavel = () => {
    if (popover.mode !== 'edit') return;
    onAiVarsChange(aiVars.filter(v => v.name !== popover.name));
    onChange(
      value
        .split(aiVarToken(popover.name))
        .join('')
        .replace(/ {2,}/g, ' ')
    );
    setPopover({ mode: 'closed' });
  };

  const insertFromDrop = (token: string, at?: number) => {
    const el = textareaRef.current;
    const start = at ?? el?.selectionStart ?? value.length;
    const { next, caret } = insertToken(value, token, start, at ?? el?.selectionEnd ?? start);
    onChange(limpar(next));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div ref={anchorRef} className="relative">
      <div className="flex items-start gap-1.5">
        {/* Clique dentro de um {{ia:...}} (o clique da textarea borbulha até aqui) abre a edição */}
        <div className="flex-1 min-w-0" onClick={abrirEdicaoNoCaret}>
          <HighlightedScript
            id={id}
            value={value}
            onChange={handleChange}
            known={known}
            textareaRef={textareaRef}
            rows={visibleRows}
            maxLength={maxLength}
            placeholder={placeholder}
            ariaLabel={ariaLabel}
            className="min-h-0"
            autoResize
            onInsertToken={insertFromDrop}
          />
        </div>
        <button
          type="button"
          className={`${BTN_SMALL} shrink-0`}
          title={insertLabel ?? 'Inserir variável'}
          aria-label={insertLabel ?? 'Inserir variável'}
          aria-expanded={menu.open}
          onClick={() => (menu.open ? fecharMenu() : abrirMenuPeloBotao())}
        >
          <Braces size={14} aria-hidden="true" />
          {insertLabel ? <span>{insertLabel}</span> : null}
        </button>
      </div>

      <FloatingLayer open={menu.open} anchorRef={anchorRef} onClose={fecharMenu} width={340} align="end" maxHeight={380} role="menu" ariaLabel="Variáveis disponíveis" className="p-1.5">
        {menu.triggerPos === null ? (
          <div className="relative mb-1 sticky top-0 bg-white dark:bg-dark-card">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={searchRef}
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-slate-900 dark:text-white outline-none focus:border-primary-500"
              placeholder="Buscar variável"
              aria-label="Buscar variável"
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>
        ) : null}
        {gruposFiltrados.map(g => (
          <div key={g.label}>
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
            {g.vars.map(v => (
              <button key={v.key} type="button" className={MENU_ITEM_CLASS} onClick={() => inserir(v.key)}>
                <span className="block text-slate-800 dark:text-slate-100">{v.description}</span>
                <code className="block font-mono text-[11px] text-blue-700 dark:text-blue-300">{v.key}</code>
              </button>
            ))}
          </div>
        ))}
        {nadaEncontrado ? (
          <p className="px-2.5 py-2 text-xs text-slate-500 dark:text-slate-400">Nenhuma variável com esse nome.</p>
        ) : null}
        {iaFiltradas.length > 0 ? (
          <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Preenchidas pela IA</p>
        ) : null}
        {iaFiltradas.map(v => (
          <button key={v.name} type="button" className={MENU_ITEM_CLASS} onClick={() => inserir(aiVarToken(v.name))}>
            <code className="font-mono text-[11px] text-fuchsia-700 dark:text-fuchsia-300">{aiVarToken(v.name)}</code>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{v.instruction}</span>
          </button>
        ))}
        <div className="border-t border-slate-200 dark:border-white/10 mt-1 pt-1 sticky bottom-0 bg-white dark:bg-dark-card">
          <button
            type="button"
            className={`${MENU_ITEM_CLASS} font-semibold text-fuchsia-700 dark:text-fuchsia-300 flex items-center gap-1.5`}
            onClick={() => abrirCriacao(menu.triggerPos)}
          >
            <Sparkles size={13} aria-hidden="true" />
            Criar variável preenchida pela IA
          </button>
        </div>
      </FloatingLayer>

      <FloatingLayer
        open={popover.mode !== 'closed'}
        anchorRef={anchorRef}
        onClose={() => setPopover({ mode: 'closed' })}
        width={400}
        align="end"
        maxHeight={520}
        role="dialog"
        ariaLabel={popover.mode === 'create' ? 'Criar variável preenchida pela IA' : 'Editar variável preenchida pela IA'}
        className="p-3"
      >
        <div className="space-y-2.5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Sparkles size={14} className="text-fuchsia-600 dark:text-fuchsia-400" aria-hidden="true" />
            {popover.mode === 'create' ? 'Variável preenchida pela IA' : popover.mode === 'edit' ? `Editar {{ia:${popover.name}}}` : ''}
          </p>
          <div>
            <label htmlFor={`${id}-iavar-nome`} className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Nome
            </label>
            <input
              id={`${id}-iavar-nome`}
              className={`${INPUT_CLASS} font-mono`}
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onBlur={() => setDraft(d => ({ ...d, name: slugAiName(d.name) }))}
              placeholder="motivo_contato"
              maxLength={40}
            />
          </div>
          <div>
            <label htmlFor={`${id}-iavar-instrucao`} className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Instrução para a IA
            </label>
            <textarea
              id={`${id}-iavar-instrucao`}
              className={TEXTAREA_CLASS}
              rows={3}
              value={draft.instruction}
              onChange={e => setDraft(d => ({ ...d, instruction: e.target.value }))}
              placeholder="Identifique resumidamente o principal motivo pelo qual o cliente entrou em contato."
              maxLength={500}
            />
          </div>
          <div>
            <label htmlFor={`${id}-iavar-exemplo`} className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Exemplo de resultado (opcional)
            </label>
            <input
              id={`${id}-iavar-exemplo`}
              className={INPUT_CLASS}
              value={draft.example}
              onChange={e => setDraft(d => ({ ...d, example: e.target.value }))}
              placeholder="Dúvida sobre honorários de ação trabalhista"
              maxLength={200}
            />
          </div>
          {draftError ? <p className="text-xs text-red-600 dark:text-red-400">{draftError}</p> : null}
          <p className={HELP_CLASS}>Na hora de executar a ação, a IA do agente lê a conversa e preenche o valor no lugar da variável.</p>
          <div className="flex items-center justify-between gap-2 pt-1">
            {popover.mode === 'edit' ? (
              <button type="button" className={`${BTN_SMALL} text-red-600 dark:text-red-400`} onClick={excluirVariavel}>
                <Trash2 size={13} aria-hidden="true" />
                Excluir
              </button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-1.5">
              <button type="button" className={BTN_SMALL} onClick={() => setPopover({ mode: 'closed' })}>
                Cancelar
              </button>
              <button
                type="button"
                className={`${BTN_SMALL} !text-white !bg-fuchsia-600 hover:!bg-fuchsia-500 !border-fuchsia-600`}
                onClick={salvarPopover}
              >
                {popover.mode === 'create' ? 'Criar e inserir' : 'Salvar'}
              </button>
            </span>
          </div>
        </div>
      </FloatingLayer>
    </div>
  );
};

export default VarField;
