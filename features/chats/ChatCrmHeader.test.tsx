import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatCrmHeader, ChatCrmHeaderActions } from './ChatCrmHeader';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

const base = {
  conversationId: 'conversation-one',
  contactId: 'contact-one',
  deal: { id: 'deal-one', title: 'Lead confirmado' },
  contactDeals: [{ id: 'deal-one', title: 'Lead confirmado' }],
  saving: false,
  detailsOpen: false,
  ownerName: 'Samuel',
  labels: [{ id: 'label-one', name: 'Novo', color: 'green' as const }],
  onLinkDeal: vi.fn(),
  onOpenDeal: vi.fn(),
  onCreateLead: vi.fn(),
  onAddContact: vi.fn(),
  onOpenLabels: vi.fn(),
  onRetryLink: vi.fn(),
  stage: <span>Em qualificação</span>,
};

describe('ChatCrmHeader', () => {
  it('places linked lead, open-card action, stage, readonly owner and tags in the CRM row', () => {
    render(<ChatCrmHeader {...base} />);
    const row = screen.getByRole('group', { name: 'Contexto CRM da conversa' });
    const text = row.textContent || '';
    expect(text.indexOf('Lead confirmado')).toBeLessThan(text.indexOf('Em qualificação'));
    expect(text.indexOf('Em qualificação')).toBeLessThan(text.indexOf('Samuel'));
    expect(text.indexOf('Samuel')).toBeLessThan(text.indexOf('Novo'));
    expect(within(row).getByRole('button', { name: 'Abrir lead' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Etiquetar' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Tirar a etiqueta/ })).not.toBeInTheDocument();
  });

  it('does not duplicate stage or owner when properties are open', () => {
    render(<ChatCrmHeader {...base} detailsOpen />);
    expect(screen.queryByText('Em qualificação')).not.toBeInTheDocument();
    expect(screen.queryByText('Samuel')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Lead vinculado a esta conversa' })).toBeInTheDocument();
  });

  it('offers multiple contact leads and preserves the empty unlink value', async () => {
    render(<ChatCrmHeader {...base} contactDeals={[...base.contactDeals, { id: 'deal-two', title: 'Outro lead' }]} />);
    const selector = screen.getByRole('combobox', { name: 'Lead vinculado a esta conversa' });
    await userEvent.click(selector);
    await userEvent.click(screen.getByRole('option', { name: 'Outro lead' }));
    expect(base.onLinkDeal).toHaveBeenLastCalledWith('deal-two');
    await userEvent.click(selector);
    await userEvent.click(screen.getByRole('option', { name: 'Sem lead vinculado' }));
    expect(base.onLinkDeal).toHaveBeenLastCalledWith(null);
  });

  it('keeps group, no-lead and error states available', () => {
    const { rerender } = render(<ChatCrmHeader {...base} isGroup participantsCount={4} />);
    expect(screen.getByText(/Grupo do WhatsApp.*4 participantes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar lead' })).not.toBeInTheDocument();
    expect(screen.getByText('Novo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Etiquetar' }));
    expect(base.onOpenLabels).toHaveBeenCalled();
    rerender(<ChatCrmHeader {...base} deal={null} contactDeals={[]} />);
    expect(screen.getByRole('button', { name: 'Criar lead' })).toBeInTheDocument();
    rerender(<ChatCrmHeader {...base} unavailable />);
    fireEvent.click(screen.getByRole('button', { name: /Lead vinculado indisponível/ }));
    expect(base.onRetryLink).toHaveBeenCalled();
  });

  it('keeps group label management available without labels and preserves contact actions without a conversation row', () => {
    const { rerender } = render(<ChatCrmHeader {...base} isGroup labels={[]} />);
    expect(screen.getByRole('button', { name: 'Etiquetar' })).toBeInTheDocument();
    rerender(<ChatCrmHeader {...base} conversationId={null} deal={null} contactDeals={[]} />);
    expect(screen.getByRole('button', { name: 'Criar lead' })).toBeInTheDocument();
    rerender(<ChatCrmHeader {...base} conversationId={null} contactId={null} deal={null} contactDeals={[]} />);
    expect(screen.getByRole('button', { name: 'Adicionar contato' })).toBeInTheDocument();
  });

  it('exposes the first-row properties action with expanded state', () => {
    const toggle = vi.fn();
    render(<ChatCrmHeaderActions hasDeal detailsOpen={false} onToggleDetails={toggle} />);
    const button = screen.getByRole('button', { name: 'Mostrar propriedades do lead' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledOnce();
  });
});
