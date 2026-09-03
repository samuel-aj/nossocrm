import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatAgentBanner, formatResumeAt } from './ChatAgentBanner';
import type { ConversationAiInfo, ConversationBotInfo } from '@/lib/wa-agents/types';

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

  it('sem agente nem robô em andamento: a faixa não aparece', () => {
    const { container } = render(<ChatAgentBanner ai={null} bot={null} busy={false} onAction={onAction} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stopped: a faixa some (iniciar é pelo botão Automações do compositor)', () => {
    const { container } = render(<ChatAgentBanner ai={info({ status: 'stopped' })} bot={null} busy={false} onAction={onAction} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('active: nome do agente, Pausar e Parar', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={info({ status: 'active' })} bot={null} busy={false} onAction={onAction} />);
    expect(screen.getByText('Agente Ana ativo nesta conversa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pausar/ }));
    expect(onAction).toHaveBeenCalledWith('pause');
    await user.click(screen.getByRole('button', { name: /Parar/ }));
    expect(onAction).toHaveBeenCalledWith('stop');
    expect(screen.queryByRole('button', { name: /Retomar/ })).not.toBeInTheDocument();
  });

  it('paused com resumeAt: mostra a hora de retomada, Retomar e Parar', async () => {
    const user = userEvent.setup();
    const resumeAt = new Date(2026, 7, 25, 9, 30, 0).toISOString();
    render(<ChatAgentBanner ai={info({ status: 'paused', resumeAt })} bot={null} busy={false} onAction={onAction} />);
    expect(screen.getByText('Agente Ana pausado, retoma às 09:30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retomar/ }));
    expect(onAction).toHaveBeenCalledWith('resume');
    expect(screen.getByRole('button', { name: /Parar/ })).toBeInTheDocument();
  });

  it('paused sem resumeAt: "até você retomar"', () => {
    render(<ChatAgentBanner ai={info({ status: 'paused', resumeAt: null })} bot={null} busy={false} onAction={onAction} />);
    expect(screen.getByText('Agente Ana pausado até você retomar')).toBeInTheDocument();
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
        bot={null}
        busy={false}
        onAction={onAction}
      />
    );
    expect(screen.getByText('Agente Ana pede aprovação para passar a Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Lead quer falar sobre rescisão.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ver resumo/ }));
    expect(screen.getByText('Lead quer falar sobre rescisão.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Aprovar/ }));
    expect(onAction).toHaveBeenCalledWith('approve');
    await user.click(screen.getByRole('button', { name: /Recusar/ }));
    expect(onAction).toHaveBeenCalledWith('reject');
  });

  it('agente externo (native false): texto próprio, Pausar/Retomar e Parar', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatAgentBanner ai={info({ status: 'active', native: false, agent: null })} bot={null} busy={false} onAction={onAction} />
    );
    expect(screen.getByText('Agente de IA externo ativo nesta conversa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pausar/ }));
    expect(onAction).toHaveBeenCalledWith('pause');
    expect(screen.getByRole('button', { name: /Parar/ })).toBeInTheDocument();

    rerender(
      <ChatAgentBanner ai={info({ status: 'paused', native: false, agent: null })} bot={null} busy={false} onAction={onAction} />
    );
    expect(screen.getByText('Agente de IA externo pausado (atendimento humano)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retomar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Iniciar/ })).not.toBeInTheDocument();
  });

  it('robô em andamento: faixa do robô com Cancelar robô', async () => {
    const user = userEvent.setup();
    const bot: ConversationBotInfo = { runId: 'r1', botId: 'b1', name: 'Boas-vindas', status: 'waiting_reply' };
    render(<ChatAgentBanner ai={null} bot={bot} busy={false} onAction={onAction} />);
    expect(screen.getByText('Robô Boas-vindas aguardando resposta do contato')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancelar robô/ }));
    expect(onAction).toHaveBeenCalledWith('cancel_bot');
  });

  it('busy: botões desabilitados e sem chamar onAction', async () => {
    const user = userEvent.setup();
    render(<ChatAgentBanner ai={info({ status: 'active' })} bot={null} busy onAction={onAction} />);
    const pausar = screen.getByRole('button', { name: /Pausar/ });
    expect(pausar).toBeDisabled();
    await user.click(pausar);
    expect(onAction).not.toHaveBeenCalled();
  });
});
