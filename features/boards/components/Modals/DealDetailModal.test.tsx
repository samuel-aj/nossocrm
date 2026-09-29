import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DealDetailModal } from "./DealDetailModal";
import type { Deal } from "@/types";
const contactDetail = vi.hoisted(() => ({
  data: null as any,
  isLoading: false,
  isError: false,
  isSuccess: false,
  refetch: vi.fn(),
}));
const detail = vi.hoisted(() => ({
  data: null as Deal | null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  refetch: vi.fn(),
}));
const behavior = vi.hoisted(() => ({
  edit: true,
  updateDeal: vi.fn(),
  analyzeLead: vi.fn(),
}));
beforeEach(() => {
  detail.data = null;
  detail.isLoading = false;
  detail.isError = false;
  detail.isSuccess = false;
  detail.refetch.mockClear();
  contactDetail.data = null;
  contactDetail.isLoading = false;
  contactDetail.isError = false;
  contactDetail.isSuccess = false;
  behavior.edit = true;
  behavior.updateDeal.mockReset().mockResolvedValue(undefined);
  behavior.analyzeLead
    .mockReset()
    .mockResolvedValue({ suggestion: "Prosseguir", probabilityScore: 75 });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          Response.json(
            String(url).includes("/timeline")
              ? {
                  history: {
                    available: true,
                    since: null,
                    events: [],
                    activityMeta: {},
                    apiNotes: [],
                  },
                  activities: [],
                  nextCursor: null,
                }
              : { followup: null },
          ),
        ),
      ),
  );
});
afterEach(() => vi.unstubAllGlobals());

vi.mock("@/features/whatsapp/DealWhatsAppChat", () => ({
  DealWhatsAppChat: ({
    contact,
    contactLoadState,
    timeline,
  }: {
    contact: { name?: string } | null;
    contactLoadState?: string;
    timeline?: { headerExtra?: React.ReactNode };
  }) => (
    <div>
      <div data-testid="resolved-contact">
        {contact?.name || contactLoadState || "none"}
      </div>
      {timeline?.headerExtra}
    </div>
  ),
}));

// Keep this test focused: we only want to ensure opening/closing the modal
// never crashes due to hook-order issues (React error #310).

vi.mock("@/hooks/useResponsiveMode", () => ({
  useResponsiveMode: () => ({ mode: "desktop" }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    organizationId: "org-1",
    profile: {
      id: "user-1",
      role: "admin",
      email: "test@example.com",
      organization_id: "org-1",
    },
  }),
}));
vi.mock("@/lib/permissions/useMyActionPermissions", () => ({
  useMyActionPermissions: () => ({
    deals: { edit: behavior.edit, move: true, delete: true },
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

vi.mock("@/lib/query/hooks", () => ({
  useMoveDealSimple: () => ({ moveDeal: vi.fn() }),
  useDeal: () => detail,
  useContact: () => contactDetail,
  useOrgUsers: () => ({ users: [], isAdmin: false, isLoading: false }),
  useOrgMembers: () => ({ members: [], isLoading: false }),
}));

vi.mock("@/lib/a11y", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFocusReturn: () => undefined,
}));

vi.mock("@/components/ConfirmModal", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/LossReasonModal", () => ({
  LossReasonModal: () => null,
}));

vi.mock("../DealSheet", () => ({
  DealSheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../StageProgressBar", () => ({
  StageProgressBar: () => null,
}));

vi.mock("@/features/activities/components/ActivityRow", () => ({
  ActivityRow: () => null,
}));

vi.mock("@/lib/ai/tasksClient", () => ({
  analyzeLead: behavior.analyzeLead,
  generateEmailDraft: vi.fn(),
  generateObjectionResponse: vi.fn(),
}));

vi.mock("@/context/CRMContext", () => ({
  useCRM: () => {
    const board = {
      id: "board-1",
      name: "Pipeline de Vendas",
      stages: [
        { id: "stage-1", label: "Novo", order: 0, linkedLifecycleStage: "MQL" },
      ],
      wonStageId: null,
      lostStageId: null,
      wonStayInStage: false,
      lostStayInStage: false,
      defaultProductId: null,
      agentPersona: null,
      goal: null,
    };

    const deal = {
      id: "deal-1",
      title: "Pequeno Chapéu",
      value: 1000,
      status: "stage-1",
      boardId: "board-1",
      contactId: "contact-1",
      companyName: "Moreira Comércio",
      contactName: "Fulano",
      contactEmail: "fulano@example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      probability: 50,
      tags: [],
      items: [],
      customFields: {},
      isWon: false,
      isLost: false,
      closedAt: undefined,
      lossReason: undefined,
    };

    return {
      sidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      deals: [deal],
      contacts: [{ id: "contact-1", stage: null }],
      updateDeal: behavior.updateDeal,
      deleteDeal: vi.fn(),
      activities: [],
      addActivity: vi.fn(),
      updateActivity: vi.fn(),
      deleteActivity: vi.fn(),
      products: [],
      addItemToDeal: vi.fn(),
      removeItemFromDeal: vi.fn(),
      customFieldDefinitions: [],
      activeBoard: board,
      boards: [board],
      lifecycleStages: [],
    };
  },
}));

describe("DealDetailModal", () => {
  it("does not crash when toggling open/close (hook order regression)", () => {
    const { rerender } = render(
      <DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />,
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>
            {children}
          </QueryClientProvider>
        ),
      },
    );

    expect(document.body.textContent).not.toContain("Application error");

    rerender(
      <DealDetailModal dealId="deal-1" isOpen={true} onClose={() => {}} />,
    );
    expect(document.body.textContent).toContain("Pequeno Chapéu");

    rerender(
      <DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />,
    );
    expect(document.body.textContent).not.toContain("Application error");
  });
});

it("abre pelo ID um lead ausente da lista filtrada e mostra carregamento até resolver", () => {
  detail.isLoading = true;
  const { rerender } = render(
    <DealDetailModal dealId="amanda" isOpen onClose={() => {}} />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  expect(screen.getByText("Carregando lead…")).toBeInTheDocument();
  detail.isLoading = false;
  detail.isSuccess = true;
  detail.data = {
    id: "amanda",
    title: "Amanda",
    boardId: "board-1",
    status: "stage-1",
    contactId: "contact-1",
    value: 0,
    probability: 0,
    tags: [],
    items: [],
    customFields: {},
    createdAt: "2026-09-03",
    isWon: false,
    isLost: false,
  } as unknown as Deal;
  rerender(<DealDetailModal dealId="amanda" isOpen onClose={() => {}} />);
  expect(screen.getByText("Amanda")).toBeInTheDocument();
  expect(screen.queryByText("Carregando lead…")).not.toBeInTheDocument();
});
it("mostra erro recuperável em vez de carregar indefinidamente um lead inacessível", () => {
  detail.isError = true;
  const onClose = vi.fn();
  render(<DealDetailModal dealId="missing" isOpen onClose={onClose} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    ),
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Não foi possível abrir este lead",
  );
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(detail.refetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("resolves a linked contact absent from the global list", () => {
  detail.data = {
    id: "lead-new",
    title: "New lead",
    value: 0,
    probability: 10,
    createdAt: "2026-09-28",
    contactId: "missing-contact",
    boardId: "board-1",
    status: "stage-1",
    tags: [],
    items: [],
    customFields: {},
  } as unknown as Deal;
  detail.isSuccess = true;
  contactDetail.isLoading = true;
  const { rerender } = render(
    <DealDetailModal dealId="lead-new" isOpen onClose={() => {}} />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  expect(screen.getByTestId("resolved-contact")).toHaveTextContent("loading");
  contactDetail.isLoading = false;
  contactDetail.isSuccess = true;
  contactDetail.data = {
    id: "missing-contact",
    name: "Fetched contact",
    phone: "+5569999999999",
  };
  rerender(<DealDetailModal dealId="lead-new" isOpen onClose={() => {}} />);
  expect(screen.getByTestId("resolved-contact")).toHaveTextContent(
    "Fetched contact",
  );
});
it("distinguishes a lookup error from a missing relationship", () => {
  detail.data = {
    id: "lead-new",
    title: "New lead",
    value: 0,
    probability: 10,
    createdAt: "2026-09-28",
    contactId: "missing-contact",
    boardId: "board-1",
    status: "stage-1",
    tags: [],
    items: [],
    customFields: {},
  } as unknown as Deal;
  detail.isSuccess = true;
  contactDetail.isError = true;
  render(<DealDetailModal dealId="lead-new" isOpen onClose={() => {}} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    ),
  });
  expect(screen.getByTestId("resolved-contact")).toHaveTextContent("error");
});
it("disables AI analysis for a read-only lead and never writes through CRM", () => {
  behavior.edit = false;
  render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    ),
  });
  fireEvent.click(screen.getByRole("button", { name: /IA Insights/ }));
  expect(
    screen.getByRole("button", { name: "Analisar Negócio" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Analisar Negócio" }));
  expect(behavior.analyzeLead).not.toHaveBeenCalled();
  expect(behavior.updateDeal).not.toHaveBeenCalled();
});
it("saves AI analysis through the canonical strict mutation when edit is allowed", async () => {
  render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    ),
  });
  fireEvent.click(screen.getByRole("button", { name: /IA Insights/ }));
  fireEvent.click(screen.getByRole("button", { name: "Analisar Negócio" }));
  await waitFor(() =>
    expect(behavior.updateDeal).toHaveBeenCalledWith(
      "deal-1",
      { aiSummary: "Prosseguir", probability: 75 },
      { throwOnError: true },
    ),
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([url]) => !String(url).startsWith("http://localhost")),
  ).toBe(true);
});
