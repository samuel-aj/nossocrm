import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatAgentBanner, formatResumeAt } from './ChatAgentBanner';
import type { AgentMinimal, ConversationAiInfo } from '@/lib/wa-agents/types';

const AGENTS: AgentMinimal[] = [
  { id: 'a1', name: 'Pré-atendimento', persona_name: 'Ana', enabled: true },
  { id: 'a2', name: 'Triagem', persona_name: null, enabled: true },
  { id: 'a3', name: 'Desligado', persona_name: null, enabled: false },
];

function info(partial: Partial<ConversationAiInfo>): ConversationAiInfo {
  return {
    conversationId: 'c1',
    status: 'active',
    native: true,
    agent: { id: 'a1', name: 'Ana', persona_name: 'Ana' },
    resumeAt: null,
    approval: null,
    ...partial,
  };
}

describe('formatResumeAt', () => {
  it('formata em HH:MM no fuso do navegador', () => {
    const d = new Date(2026, 7, 25, 15, 7, 0);
    expect(formatResumeAt(d.toISOString())).toBe('15:07');
  });

  it('devolve vazio para data inválida', () => {
    expect(formatResumeAt('nada')).toBe('');
  });
});

describe('ChatAgentBanner', () => {
  const onAction = vi.fn();

  beforeEach(() => {
    onAction.mockClear();
  });

  it('sem agente: botão discreto abre o menu com os agentes ligados e inicia', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={null} agents={AGENTS} busy={false} onAction={onAction} />);

    const btn = screen.getByRole('button', { name: /Iniciar agente de IA/ });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(btn);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Pré-atendimento')).toBeInTheDocument();
    expect(screen.getByText('Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Desligado')).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /Triagem/ }));
    expect(onAction).toHaveBeenCalledWith('start', 'a2');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('menu vazio mostra "Nenhum agente configurado"', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={null} agents={[]} busy={false} onAction={onAction} />);
    await user.click(screen.getByRole('button', { name: /Iniciar agente de IA/ }));
    expect(screen.getByText('Nenhum agente configurado')).toBeInTheDocument();
  });

  it('menu fecha com Escape e com clique fora', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span data-testid="fora">fora</span>
        <ChatAgentBanner ai={null} agents={AGENTS} busy={false} onAction={onAction} />
      </div>
    );
    const btn = screen.getByRole('button', { name: /Iniciar agente de IA/ });

    await user.click(btn);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(btn);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('fora'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('active: nome do agente, Pausar e Parar', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={info({ status: 'active' })} agents={AGENTS} busy={false} onAction={onAction} />);
    expect(screen.getByText('Agente Ana ativo nesta conversa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pausar/ }));
    expect(onAction).toHaveBeenCalledWith('pause', undefined);
    await user.click(screen.getByRole('button', { name: /Parar/ }));
    expect(onAction).toHaveBeenCalledWith('stop', undefined);
    expect(screen.queryByRole('button', { name: /Retomar/ })).not.toBeInTheDocument();
  });

  it('paused com resumeAt: mostra a hora de retomada, Retomar e Parar', async () => {
    const user = userEvent.setup();
    const resumeAt = new Date(2026, 7, 25, 9, 30, 0).toISOString();
    render(
      <ChatAgentBanner ai={info({ status: 'paused', resumeAt })} agents={AGENTS} busy={false} onAction={onAction} />
    );
    expect(screen.getByText('Agente Ana pausado, retoma às 09:30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retomar/ }));
    expect(onAction).toHaveBeenCalledWith('resume', undefined);
    expect(screen.getByRole('button', { name: /Parar/ })).toBeInTheDocument();
  });

  it('paused sem resumeAt: "até você retomar"', () => {
    render(
      <ChatAgentBanner ai={info({ status: 'paused', resumeAt: null })} agents={AGENTS} busy={false} onAction={onAction} />
    );
    expect(screen.getByText('Agente Ana pausado até você retomar')).toBeInTheDocument();
  });

  it('stopped: texto cinza e menu Iniciar', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={info({ status: 'stopped' })} agents={AGENTS} busy={false} onAction={onAction} />);
    expect(screen.getByText('Agente parado nesta conversa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Iniciar/ }));
    await user.click(screen.getByRole('menuitem', { name: /Pré-atendimento/ }));
    expect(onAction).toHaveBeenCalledWith('start', 'a1');
  });

  it('awaiting_approval: texto, resumo expansível, Aprovar e Recusar', async () => {
    const user = userEvent.setup();
    render(
      <ChatAgentBanner
        ai={info({
          status: 'awaiting_approval',
          approval: {
            nextAgentId: 'a2',
            nextAgentName: 'Triagem',
            summary: 'Lead quer falar sobre rescisão.',
            requestedAt: new Date().toISOString(),
          },
        })}
        agents={AGENTS}
        busy={false}
        onAction={onAction}
      />
    );
    expect(screen.getByText('Agente Ana pede aprovação para passar a Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Lead quer falar sobre rescisão.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ver resumo/ }));
    expect(screen.getByText('Lead quer falar sobre rescisão.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Aprovar/ }));
    expect(onAction).toHaveBeenCalledWith('approve', undefined);
    await user.click(screen.getByRole('button', { name: /Recusar/ }));
    expect(onAction).toHaveBeenCalledWith('reject', undefined);
  });

  it('agente externo (native false): só Pausar/Retomar, sem Parar nem Iniciar', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatAgentBanner
        ai={info({ status: 'active', native: false, agent: null })}
        agents={AGENTS}
        busy={false}
        onAction={onAction}
      />
    );
    expect(screen.getByText('Agente de IA ativo nesta conversa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Parar/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pausar/ }));
    expect(onAction).toHaveBeenCalledWith('pause', undefined);

    rerender(
      <ChatAgentBanner
        ai={info({ status: 'paused', native: false, agent: null })}
        agents={AGENTS}
        busy={false}
        onAction={onAction}
      />
    );
    expect(screen.getByText('Agente de IA pausado (atendimento humano)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retomar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Parar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Iniciar/ })).not.toBeInTheDocument();
  });

  it('busy: botões desabilitados e sem chamar onAction', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={info({ status: 'active' })} agents={AGENTS} busy onAction={onAction} />);
    const pausar = screen.getByRole('button', { name: /Pausar/ });
    expect(pausar).toBeDisabled();
    await user.click(pausar);
    expect(onAction).not.toHaveBeenCalled();
  });
});
