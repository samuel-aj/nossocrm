import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConnectionDiagnostics } from '@/lib/whatsapp/connectionDiagnostics';
import { LineHealthDetails, LineStatusBadge } from './WhatsAppLineHealth';

describe('status por número', () => {
  it('keeps an incident visible alongside a healthy line and identifies receipt while sending was interrupted', () => {
    const health: ConnectionDiagnostics = {
      state: 'send_failure', lastCheckedAt: '2026-11-18T10:00:00Z', lastDeliveredMessageAt: '2026-11-17T20:00:00Z',
      incidentOpenedAt: '2026-11-18T01:00:00Z', receivedDuringIncidentAt: '2026-11-18T09:55:00Z', failedCount: 0,
      lastIncident: null,
      identityMismatch: true, pendingCount: 2, reviewCount: 1, historyAvailable: true,
    };
    render(<>
      <section aria-label="Número A"><LineStatusBadge state={health.state} /><LineHealthDetails health={health} /></section>
      <section aria-label="Número B"><LineStatusBadge state="connected" /></section>
    </>);
    const first = within(screen.getByRole('region', { name: 'Número A' }));
    expect(first.getByText('Envio interrompido')).toBeInTheDocument();
    expect(first.getByText(/O número recebeu mensagem/)).toBeInTheDocument();
    expect(first.getByText(/Último envio com entrega confirmada/)).toBeInTheDocument();
    expect(first.getByText(/2 envios em recuperação/)).toBeInTheDocument();
    expect(first.getByText(/1 envio aguarda conferência/)).toBeInTheDocument();
    expect(first.getByText(/Reconecte o número original/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Número B' })).getByText('Conectado')).toBeInTheDocument();
  });
  it('keeps the last incident visible after recovery without presenting it as an active outage', () => {
    const health: ConnectionDiagnostics = {
      state: 'connected', lastCheckedAt: '2026-11-18T12:01:00Z', lastDeliveredMessageAt: '2026-11-18T12:00:00Z',
      incidentOpenedAt: null, receivedDuringIncidentAt: null, failedCount: 0, pendingCount: 0, reviewCount: 0,
      identityMismatch: false, historyAvailable: true,
      lastIncident: {
        openedAt: '2026-11-18T10:00:00Z', resolvedAt: '2026-11-18T12:00:00Z',
        detectedBy: 'Controle de envio do CRM', observedBy: 'Evento recebido do provedor',
        observedAt: '2026-11-18T10:03:00Z', observation: 'A Evolution informou o código de desconexão 401.',
      },
    };
    render(<><LineStatusBadge state={health.state} /><LineHealthDetails health={health} /></>);
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText(/Incidente de conexão desde/)).not.toBeInTheDocument();
    expect(screen.getByText(/Último incidente de/)).toBeInTheDocument();
    expect(screen.getByText(/código de desconexão 401/)).toBeInTheDocument();
    expect(screen.getByText(/Origem do incidente · Controle de envio do CRM/)).toBeInTheDocument();
    expect(screen.getByText(/Evento recebido do provedor/).querySelector('time')).toHaveAttribute('datetime', health.lastIncident!.observedAt);
  });
});
