import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Board } from '@/types';
import { StageCascadePicker } from './StageCascadePicker';

const board = { id: 'b', name: 'Funil', stages: [{ id: 's', label: 'Novo', order: 0 }], wonStayInStage: true, lostStayInStage: true } as Board;

describe('encerramento na cascata de etapas', () => {
  it('oferece ganho e perda sem mudar de etapa', () => {
    const onOutcome = vi.fn();
    render(<StageCascadePicker boards={[board]} boardId="b" stageId="s" onPick={vi.fn()} onOutcome={onOutcome} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('option', { name: 'Ganho' }));
    expect(onOutcome).toHaveBeenCalledWith('won');
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('option', { name: 'Perdido' }));
    expect(onOutcome).toHaveBeenCalledWith('lost');
  });
  it('permite reabrir um lead encerrado na própria etapa', () => {
    const onPick = vi.fn();
    render(<StageCascadePicker boards={[board]} boardId="b" stageId="s" onPick={onPick} outcome="won" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('option', { name: /Novo/ }));
    expect(onPick).toHaveBeenCalledWith(board, board.stages[0]);
  });
});
