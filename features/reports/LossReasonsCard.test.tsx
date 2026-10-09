import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Deal } from '@/types';
import { LossReasonsCard } from './LossReasonsCard';

const losses = (reasons: string[]): Deal[] => reasons.map((lossReason, index) => ({ id: `loss-${index}`, lossReason } as Deal));

it('mostra os cinco motivos mais frequentes, expande o restante e permite recolher', async () => {
  const user = userEvent.setup();
  const reasons = ['Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Mais frequente', 'Mais frequente', 'Mais frequente'];
  render(<LossReasonsCard deals={losses(reasons)} barClass="bg-red-500" onSelect={vi.fn()} />);
  expect(screen.getByText('9 perdas · participação dentro desta categoria')).toBeVisible();
  const rows = screen.getAllByRole('button', { name: /: ver \d+ leads$/ });
  expect(rows).toHaveLength(5);
  expect(rows[0]).toHaveAccessibleName('Mais frequente: ver 3 leads');
  expect(within(rows[0]).getByText('3', { exact: true })).toBeVisible();
  expect(rows[0]).toHaveTextContent('33,3%');
  expect(screen.getByText('Outros motivos').parentElement).toHaveTextContent('2');
  const expand = screen.getByRole('button', { name: 'Ver todos os 7 motivos' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  await user.click(expand);
  expect(screen.getAllByRole('button', { name: /: ver \d+ leads$/ })).toHaveLength(7);
  expect(screen.queryByText('Outros motivos')).not.toBeInTheDocument();
  const collapse = screen.getByRole('button', { name: 'Mostrar os 5 principais' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await user.click(collapse);
  expect(screen.getAllByRole('button', { name: /: ver \d+ leads$/ })).toHaveLength(5);
});

it('envia a chave normalizada do grupo, conservando rótulos completos e sem juntar motivos diferentes', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const longReason = 'Contato solicitou uma nova conversa após concluir a reorganização financeira da empresa';
  render(<LossReasonsCard deals={losses(['Contato Repetido', ' Lead repetido! ', 'REPETIDO', longReason, 'Sem orçamento', 'Preço muito alto'])}
    barClass="bg-red-500" onSelect={onSelect} />);
  const duplicates = screen.getByRole('button', { name: 'Contato repetido: ver 3 leads' });
  expect(within(duplicates).getByText('3', { exact: true })).toBeVisible();
  expect(duplicates).toHaveTextContent('50%');
  await user.click(duplicates);
  expect(onSelect).toHaveBeenLastCalledWith('duplicate_contact');
  const fullName = screen.getByRole('button', { name: `${longReason}: ver 1 leads` });
  expect(within(fullName).getByText(longReason)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Sem orçamento: ver 1 leads' }));
  expect(onSelect).toHaveBeenLastCalledWith('text:sem orcamento');
  expect(screen.getByRole('button', { name: 'Preço muito alto: ver 1 leads' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Ver todos/ })).not.toBeInTheDocument();
});

it('explica categoria sem perdas sem apresentar barras ou botões vazios', () => {
  render(<LossReasonsCard deals={[]} barClass="bg-red-500" onSelect={vi.fn()} />);
  expect(screen.getByText('Nenhuma perda nesta categoria.')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
