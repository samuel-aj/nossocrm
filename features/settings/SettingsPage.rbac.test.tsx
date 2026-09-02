import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useSearchParams: () => ({
    get: () => null,
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

// Aparência (dentro de Geral) lê o tema do ThemeContext (sem provider no teste).
vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({
    darkMode: false,
    toggleDarkMode: vi.fn(),
    mode: 'light',
    setMode: vi.fn(),
    theme: 'roxo',
    setTheme: vi.fn(),
    applyServerPrefs: vi.fn(),
  }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), showToast: vi.fn() }),
}))

vi.mock('./hooks/useSettingsController', () => ({
  useSettingsController: () => ({
    defaultRoute: '/boards',
    setDefaultRoute: vi.fn(),
  }),
}))

// A aba CRM lê campos, grupos e tags direto do SettingsContext (sem provider no teste).
vi.mock('@/context/settings/SettingsContext', () => ({
  useSettings: () => ({
    customFieldDefinitions: [],
    addCustomField: vi.fn(),
    updateCustomField: vi.fn(),
    removeCustomField: vi.fn(),
    customFieldGroups: [],
    addCustomFieldGroup: vi.fn(),
    removeCustomFieldGroup: vi.fn(),
    reorderCustomFields: vi.fn(),
    reorderCustomFieldGroups: vi.fn(),
    availableTags: ['VIP'],
    addTag: vi.fn(),
    removeTag: vi.fn(),
  }),
}))

// Motivos de perda usam react-query (sem provider no teste).
vi.mock('./components/LossReasonsSettings', () => ({
  LossReasonsSettings: () => null,
}))

// Evita depender de providers (Toast/Boards/Supabase) ao renderizar a aba Integrações no teste.
vi.mock('./components/ApiKeysSection', () => ({
  ApiKeysSection: () => (
    <div>
      <h3>API (Integrações)</h3>
    </div>
  ),
}))

vi.mock('./components/WebhooksSection', () => ({
  WebhooksSection: () => (
    <div>
      <h3>Webhooks (Integrações)</h3>
    </div>
  ),
}))

vi.mock('./components/McpSection', () => ({
  McpSection: () => (
    <div>
      <h3>MCP (Integrações)</h3>
    </div>
  ),
}))

// Acesso às automações: o hook usa react-query (sem provider no teste). A aba
// "IA e Automações" aparece para qualquer papel; as sub-abas de agentes/robôs
// só para admin, e o agente de IA fica bloqueado até o super admin liberar.
vi.mock('@/hooks/useWaAgentsAccess', () => ({
  useWaAgentsAccess: () => ({ agentsApproved: false, isAdmin: false, isLoading: false }),
}))
vi.mock('@/features/wa-agents/WaAgentsSettings', () => ({
  WaAgentsSettings: () => null,
}))

import SettingsPage from './SettingsPage'
import { useAuth } from '@/context/AuthContext'

const useAuthMock = vi.mocked(useAuth)

describe('SettingsPage RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('vendedor não vê seções de configuração do sistema', () => {
    useAuthMock.mockReturnValue({
      profile: { role: 'vendedor' },
    } as any)

    render(<SettingsPage />)

    // Sem as categorias de administração
    expect(screen.queryByRole('tab', { name: /^CRM$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /integrações/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /equipe/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Tags$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Campos personalizados$/i })).not.toBeInTheDocument()

    // Preferências pessoais seguem visíveis
    expect(screen.getByText(/página inicial/i)).toBeInTheDocument()
    // Aparência mora dentro de Geral
    expect(screen.getByRole('heading', { name: /^Aparência$/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /ia e automações/i })).toBeInTheDocument()
  })

  it('admin vê seções de configuração do sistema', async () => {
    useAuthMock.mockReturnValue({
      profile: { role: 'admin' },
    } as any)

    render(<SettingsPage />)

    // CRM: campos personalizados e tags
    fireEvent.click(screen.getByRole('tab', { name: /^CRM$/i }))
    expect(await screen.findByRole('heading', { name: /^Campos personalizados$/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /^Tags$/i })).toBeInTheDocument()

    // Integrações com as sub-abas
    fireEvent.click(screen.getByRole('tab', { name: /integrações/i }))
    const webhooksSubTab = await screen.findByRole('tab', { name: /^Webhooks$/i })
    const apiSubTab = await screen.findByRole('tab', { name: /API e chaves/i })
    const mcpSubTab = await screen.findByRole('tab', { name: /^MCP$/i })

    // Padrão é Webhooks
    expect(await screen.findByRole('heading', { name: /^Webhooks \(Integrações\)$/i })).toBeInTheDocument()

    fireEvent.click(apiSubTab)
    expect(await screen.findByRole('heading', { name: /^API \(Integrações\)$/i })).toBeInTheDocument()

    fireEvent.click(mcpSubTab)
    expect(await screen.findByRole('heading', { name: /^MCP \(Integrações\)$/i })).toBeInTheDocument()

    expect(webhooksSubTab).toBeInTheDocument()
  })
})
