import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { AgentPublic, CustomAction, EndAction } from '@/lib/wa-agents/types';
import { ActionsEditor, type KnowledgeChoices } from './OutcomesEditor';
import { toAgentInput } from './AgentList';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const knowledge: KnowledgeChoices = {
  documents: [
    { id: 'catalogo', name: 'precos.pdf', title: 'Catálogo', status: 'ready' },
    { id: 'politica', name: 'politica.pdf', status: 'ready' },
    { id: 'rascunho', name: 'pendente.pdf', status: 'processing' },
  ],
};
const editorProps = { agents: [], options: undefined, currentAgentId: 'agente', idPrefix: 'regra' };

it('permite escolher um documento pronto e descrever o conteúdo que o agente deve consultar', async () => {
  const saved = vi.fn();
  function Editor() {
    const [value, setValue] = useState<EndAction[]>([{ type: 'note' }]);
    return <ActionsEditor {...editorProps} value={value} knowledge={knowledge} onChange={next => {
      setValue(next);
      saved(next);
    }} />;
  }
  render(<Editor />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Tipo da ação 1' }));
  await userEvent.click(screen.getByRole('option', { name: 'Consultar base de conhecimento' }));
  const picker = screen.getByRole('combobox', { name: 'Base de conhecimento' });
  expect(picker).toHaveTextContent('Selecione um documento');
  await userEvent.click(picker);
  expect(screen.queryByRole('option', { name: 'pendente.pdf' })).toBeNull();
  expect(screen.getByRole('option', { name: 'politica.pdf' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: 'Catálogo (precos.pdf)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Descrição da base' }), { target: { value: 'Preços dos produtos' } });
  expect(saved).toHaveBeenLastCalledWith([{ type: 'consult_knowledge', knowledgeId: 'catalogo', description: 'Preços dos produtos' }]);
});

it('mantém a referência removida visível para correção e omite consultas no menu de encerramento', async () => {
  const consultation = { type: 'consult_knowledge', knowledgeId: 'removido', description: 'Preços' } as const;
  const onChange = vi.fn();
  const { rerender } = render(<ActionsEditor {...editorProps} knowledge={knowledge} value={[consultation]} onChange={onChange} />);
  expect(screen.getByRole('combobox', { name: 'Base de conhecimento' })).toHaveTextContent('indisponível');
  expect(onChange).not.toHaveBeenCalled();
  rerender(<ActionsEditor {...editorProps} value={[{ type: 'note' }]} onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Tipo da ação 1' }));
  expect(screen.getByRole('option', { name: 'Registrar nota no negócio' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Consultar base de conhecimento' })).toBeNull();
});

it('ao duplicar o agente, mantém os outros passos e remove consultas a documentos do original', () => {
  const consultation: EndAction = { type: 'consult_knowledge', knowledgeId: 'catalogo', description: 'Preços' };
  const regra: CustomAction = { key: 'precos', label: 'Preços', description: 'Ao perguntar pelo preço', actions: [consultation] };
  const mista: CustomAction = { ...regra, key: 'nota', actions: [{ type: 'note' }, consultation] };
  const evento: CustomAction = { ...regra, key: 'evento', actions: [] };
  const roteiro = 'Preço [[acao:precos]]de hoje.\n[[ ACAO : PRECOS ]][[acao:nota]][[acao:evento]][[midia:precos]][[acao:outra]]';
  const original = { custom_actions: [regra, mista, evento], system_prompt: roteiro } as AgentPublic;
  const copia = toAgentInput(original);
  expect(copia.custom_actions).toEqual([{ ...mista, actions: [{ type: 'note' }] }, evento]);
  expect(copia.system_prompt).toBe('Preço de hoje.\n[[acao:nota]][[acao:evento]][[midia:precos]][[acao:outra]]');
  expect(original.system_prompt).toBe(roteiro);
  expect(original.custom_actions).toEqual([regra, mista, evento]);
});
