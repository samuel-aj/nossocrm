import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact, Deal } from "@/types";
import { LeadPropertiesPanel } from "./LeadPropertiesPanel";
import { queryKeys } from "@/lib/query/queryKeys";

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

async function chooseProduct() {
  await userEvent.click(screen.getByRole("combobox", { name: "Produto ou serviço" }));
  await userEvent.click(screen.getByRole("option", { name: /Serviço/ }));
}

const mocks = vi.hoisted(() => ({
  updateDeal: vi.fn(),
  updateContact: vi.fn(),
  addItemToDeal: vi.fn(),
  updateItemInDeal: vi.fn(),
  removeItemFromDeal: vi.fn(),
  deleteDeal: vi.fn(),
  addTag: vi.fn(),
  addToast: vi.fn(),
  edit: true,
  move: true,
  remove: true,
  org: "org-1",
}));
vi.mock("@/features/group-links/api", () => ({ groupLinksApi: { settings: async () => ({ enabled: false }) } }));
vi.mock("@/context/CRMContext", () => ({
  useCRM: () => ({
    updateDeal: mocks.updateDeal,
    updateContact: mocks.updateContact,
    addItemToDeal: mocks.addItemToDeal,
    updateItemInDeal: mocks.updateItemInDeal,
    removeItemFromDeal: mocks.removeItemFromDeal,
    deleteDeal: mocks.deleteDeal,
    addTag: mocks.addTag,
    availableTags: ["Existente"],
    products: [{ id: "product", name: "Serviço", price: 100 }],
    boards: [{ id: "board", name: "Funil", hiddenFieldGroups: ["Oculto"] }],
    customFieldDefinitions: [
      { id: 'legacy-source', key: 'origem', label: 'Origem legada', type: 'select', options: ['Evento antigo'] },
      { id: "utm1", key: "utm_source", label: "Fonte UTM", type: "text" },
      { id: "utm2", key: "utm_extra", label: "Extra UTM", type: "number" },
      { id: "z", key: "z", label: "Z field", type: "text", groupName: "Zebra" },
      { id: "field-1", key: "source", label: "Origem", type: "text" },
      {
        id: "field-2",
        key: "score",
        label: "Pontuação",
        type: "number",
        groupName: "Análise",
      },
      {
        id: "field-3",
        key: "secret",
        label: "Segredo",
        type: "text",
        groupName: "Oculto",
      },
      {
        id: "field-4",
        key: "preferences",
        label: "Preferências",
        type: "multiselect",
        options: ["A"],
      },
      { id: "field-5", key: "active", label: "Ativo", type: "text" },
    ],
  }),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ organizationId: mocks.org }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ addToast: mocks.addToast }),
}));
vi.mock("@/lib/permissions/useMyActionPermissions", () => ({
  useMyActionPermissions: () => ({
    deals: { edit: mocks.edit, move: mocks.move, delete: mocks.remove },
  }),
}));
vi.mock("@/lib/query/hooks", () => ({
  useContactsPaginated: () => ({
    data: { data: [{ id: "joao", name: "João", phone: "+556798671148", email: "joao@example.com" }], hasMore: false },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  }),
  useOrgUsers: () => ({ isAdmin: mocks.edit }),
  useOrgMembers: () => ({
    data: [{ id: "owner-1", name: "Samuel", member: true }],
  }),
}));
vi.mock("@/features/boards/hooks/useAcknowledgeAlert", () => ({
  useAcknowledgeAlert: vi.fn(),
}));
vi.mock("@/features/deals/LossDetailsBanner", () => ({
  LossDetailsBanner: () => null,
}));
vi.mock("@/lib/a11y", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFocusReturn: () => undefined,
}));
vi.mock("./DealStageControl", () => ({
  DealStageControl: () => <button>Etapa</button>,
}));
vi.mock("./FollowupStatus", () => ({ FollowupStatus: () => null }));
const deal = {
  id: "lead-1",
  title: "Lead A",
  boardId: "board",
  contactId: "contact",
  status: "stage",
  value: 250,
  priority: "medium",
  probability: 10,
  createdAt: "2026-09-01T00:00:00Z",
  tags: [],
  items: [],
  customFields: {},
  ownerId: "owner-1",
} as unknown as Deal;
const contact = {
  id: "contact",
  name: "Maria",
  phone: "1234",
  status: "ACTIVE",
} as Contact;
function setup(
  current = deal,
  callbacks: { onDeleted?: () => void; onClose?: () => void } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    wrapper,
    ...render(
      <LeadPropertiesPanel
        key={current.id}
        deal={current}
        contact={contact}
        {...callbacks}
      />,
      { wrapper },
    ),
  };
}
beforeEach(() => {
  mocks.edit = true;
  mocks.move = true;
  mocks.remove = true;
  mocks.org = "org-1";
  for (const mock of [
    mocks.updateDeal,
    mocks.updateContact,
    mocks.addItemToDeal,
    mocks.updateItemInDeal,
    mocks.removeItemFromDeal,
    mocks.deleteDeal,
    mocks.addTag,
    mocks.addToast,
  ]) {
    mock.mockReset();
    mock.mockResolvedValue(undefined);
  }
  mocks.addItemToDeal.mockResolvedValue({ id: "item" });
});

describe("LeadPropertiesPanel", () => {
  it('edits native source and explicitly clears legacy source without rewriting custom fields or UTMs', async () => {
    const current = { ...deal, customFields: { origem: 'Evento antigo', utm_source: 'google', utm_campaign: 'Campanha original' } };
    setup(current);
    const select = screen.getByRole('combobox', { name: 'Origem do lead' });
    expect(select).toHaveTextContent('Evento antigo');
    fireEvent.click(screen.getByRole('button', { name: /Campos personalizados/ }));
    expect(screen.queryByText('Origem legada')).not.toBeInTheDocument();
    await userEvent.click(select);
    await userEvent.click(screen.getByRole('option', { name: 'Não informado' }));
    await waitFor(() => expect(mocks.updateDeal).toHaveBeenCalledWith('lead-1', { leadSource: null }, { throwOnError: true }));
    expect(current.customFields).toEqual({ origem: 'Evento antigo', utm_source: 'google', utm_campaign: 'Campanha original' });
  });

  it('respects explicit unknown source over legacy data and read-only permission', () => {
    mocks.edit = false;
    setup({ ...deal, leadSource: null, customFields: { origem: 'Evento antigo' } });
    const select = screen.getByRole('combobox', { name: 'Origem do lead' });
    expect(select).toHaveTextContent('Não informado');
    expect(select).toBeDisabled();
    expect(mocks.updateDeal).not.toHaveBeenCalled();
  });

  it('keeps the prior source visible and reports a rejected save', async () => {
    mocks.updateDeal.mockRejectedValue(new Error('Origem não salva'));
    setup({ ...deal, leadSource: 'Google Ads' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Origem do lead' }));
    await userEvent.click(screen.getByRole('option', { name: 'Meta Ads' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Origem não salva'));
    expect(screen.getByRole('combobox', { name: 'Origem do lead' })).toHaveTextContent('Google Ads');
  });

  it("changes only the lead contact and seeds the selected contact for the chat", async () => {
    const { client } = setup();
    client.setQueryData(queryKeys.contacts.lists(), [contact]);
    fireEvent.click(screen.getByRole("button", { name: "Trocar contato" }));
    fireEvent.click(screen.getByRole("button", { name: /João/ }));
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(mocks.updateDeal).toHaveBeenCalledWith(
      "lead-1", { contactId: "joao" }, { throwOnError: true },
    ));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar contato" })).not.toBeInTheDocument());
    expect(client.getQueryData<Contact>(queryKeys.contacts.detail("joao"))?.name).toBe("João");
    expect(client.getQueryData<Contact[]>(queryKeys.contacts.lists())?.map(row => row.id)).toEqual(["contact", "joao"]);
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("retains the contact selection and does not claim success on save failure", async () => {
    mocks.updateDeal.mockRejectedValue(new Error("Sem permissão para alterar o contato"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Trocar contato" }));
    fireEvent.click(screen.getByRole("button", { name: /João/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(screen.getByText(/Não foi possível trocar o contato/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar contato" })).toBeEnabled();
    expect(screen.queryByText(/Salvo ·/)).not.toBeInTheDocument();
  });

  it("hides contact replacement without permission to edit the lead", () => {
    mocks.edit = false;
    setup();
    expect(screen.queryByRole("button", { name: "Trocar contato" })).not.toBeInTheDocument();
  });

  it("uses the information icon for Detalhes", () => {
    setup();
    const details = screen.getByRole("button", { name: /Detalhes/ });
    expect(details.querySelector("svg.lucide-info")).toBeInTheDocument();
    expect(details.querySelector("svg.lucide-folder-open")).not.toBeInTheDocument();
  });

  it("opens Negócio and Contato, collapses the other independent sections, and never saves on expansion", () => {
    setup();
    expect(screen.getByRole("button", { name: /Negócio/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /Contato/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const label of [
      /Campos personalizados/,
      /Produtos/,
      /UTMs/,
      /Detalhes/,
    ])
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    fireEvent.click(
      screen.getByRole("button", { name: /Campos personalizados/ }),
    );
    expect(
      screen.getByRole("button", { name: /Campos personalizados/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Negócio/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    expect(screen.getByText("Origem")).toBeInTheDocument();
    expect(screen.queryByText("Segredo")).toBeNull();
  });
  it("validates title and keeps its draft when canonical save rejects", async () => {
    mocks.updateDeal.mockRejectedValueOnce(new Error("Falha no banco"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    const input = screen.getByRole("textbox", { name: "Nome do negócio" });
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Lead Novo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Falha no banco"),
    );
    expect(input).toHaveValue("Lead Novo");
    expect(mocks.updateDeal).toHaveBeenCalledWith(
      "lead-1",
      { title: "Lead Novo" },
      { throwOnError: true },
    );
  });
  it("validates the value and retains the description on failed save", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /R\$\s*250/ }));
    const value = screen.getByRole("textbox", { name: "Valor do negócio" });
    fireEvent.change(value, { target: { value: "-1" } });
    fireEvent.keyDown(value, { key: "Enter" });
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    fireEvent.change(value, { target: { value: "300" } });
    fireEvent.keyDown(value, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.updateDeal).toHaveBeenCalledWith(
        "lead-1",
        { value: 300 },
        { throwOnError: true },
      ),
    );
    mocks.updateDeal.mockRejectedValueOnce(new Error("Descrição falhou"));
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar descrição..." }),
    );
    const description = screen.getByRole("textbox", {
      name: "Descrição do lead",
    });
    fireEvent.change(description, { target: { value: "Rascunho importante" } });
    fireEvent.blur(description);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Descrição falhou"),
    );
    expect(description).toHaveValue("Rascunho importante");
  });
  it("calls canonical product and owner mutations and renders each property once", async () => {
    setup();
    expect(screen.getAllByText("Prioridade")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Responsável pelo lead" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sem responsável" }));
    await waitFor(() =>
      expect(mocks.updateDeal).toHaveBeenCalledWith(
        "lead-1",
        { ownerId: "" },
        { throwOnError: true },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Produtos/ }));
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(mocks.addItemToDeal).toHaveBeenCalledWith(
        "lead-1",
        expect.objectContaining({
          productId: "product",
          price: 100,
          quantity: 1,
        }),
      ),
    );
  });
  it("distinguishes custom fields and UTM sections with their own icons", () => {
    setup();
    expect(screen.getByRole("button", { name: "Campos personalizados" }).querySelector("svg")).toHaveClass("lucide-list");
    expect(screen.getByRole("button", { name: "UTMs" }).querySelector("svg")).toHaveClass("lucide-radar");
  });
  it("is read-only without edit/delete permissions and confirms deletion when allowed", async () => {
    mocks.edit = false;
    mocks.remove = false;
    const view = setup();
    expect(screen.getByRole("button", { name: "Lead A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /R\$\s*250/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Opções do negócio" }));
    expect(
      screen.getByRole("button", { name: "Excluir negócio" }),
    ).toBeDisabled();
    view.unmount();
    mocks.edit = true;
    mocks.remove = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Opções do negócio" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir negócio" }));
    expect(mocks.deleteDeal).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Excluir",
      }),
    );
    await waitFor(() =>
      expect(mocks.deleteDeal).toHaveBeenCalledWith("lead-1", {
        throwOnError: true,
      }),
    );
  });
  it("does not clear a new lead editor when an old save settles", async () => {
    let finish!: () => void;
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "A editado" },
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
      { key: "Enter" },
    );
    rerender(
      <LeadPropertiesPanel
        key="lead-2"
        deal={{ ...deal, id: "lead-2", title: "Lead B" }}
        contact={contact}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Lead B" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "B editado" },
    });
    await act(async () => finish());
    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
    ).toHaveValue("B editado");
  });
  it("does not show an old lead failure on a newly selected lead", async () => {
    let reject!: (error: Error) => void;
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "A editado" },
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
      { key: "Enter" },
    );
    rerender(
      <LeadPropertiesPanel
        key="lead-2"
        deal={{ ...deal, id: "lead-2", title: "Lead B" }}
        contact={contact}
      />,
    );
    await act(async () => reject(new Error("A falhou")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Lead B" })).toBeInTheDocument();
  });
  it("cancels an editor with Escape without saving or closing the panel", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "Cancelar" },
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
      { key: "Escape" },
    );
    expect(screen.getByRole("button", { name: "Lead A" })).toBeInTheDocument();
    expect(mocks.updateDeal).not.toHaveBeenCalled();
  });
  it("keeps custom-field editor open on validation and server failure", async () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: /Campos personalizados/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Análise/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Pontuação" }));
    const score = screen.getByRole("textbox", { name: "Pontuação" });
    fireEvent.change(score, { target: { value: "abc" } });
    fireEvent.keyDown(score, { key: "Enter" });
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    mocks.updateDeal.mockRejectedValueOnce(new Error("Campo não salvo"));
    fireEvent.change(score, { target: { value: "15" } });
    fireEvent.keyDown(score, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Campo não salvo"),
    );
    expect(score).toHaveValue("15");
    expect(mocks.updateDeal).toHaveBeenCalledWith(
      "lead-1",
      { customFields: { score: 15 } },
      { throwOnError: true },
    );
  });
  it("invalidates the shared paginated history after a successful property save", async () => {
    const { client } = setup();
    const key = ["leadHistory", "org-1", "lead-1"];
    client.setQueryData(key, { pages: [], pageParams: [] });
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "Novo nome" },
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
      { key: "Enter" },
    );
    await waitFor(() =>
      expect(client.getQueryState(key)?.isInvalidated).toBe(true),
    );
  });
  it("retains catalog selection and edited item on canonical failure", async () => {
    mocks.addItemToDeal.mockResolvedValueOnce(null);
    const current = {
      ...deal,
      items: [
        {
          id: "item-1",
          productId: "product",
          name: "Serviço",
          price: 100,
          quantity: 2,
        },
      ],
    } as Deal;
    setup(current);
    fireEvent.click(screen.getByRole("button", { name: /Produtos/ }));
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível salvar",
      ),
    );
    expect(
      screen.getByRole("combobox", { name: "Produto ou serviço" }),
    ).toHaveTextContent("Serviço");
    mocks.updateItemInDeal.mockRejectedValueOnce(new Error("Preço não salvo"));
    fireEvent.click(screen.getByRole("button", { name: /2 ×/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Preço de Serviço neste lead" }),
      { target: { value: "125,50" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar Serviço" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Preço não salvo"),
    );
    expect(
      screen.getByRole("textbox", { name: "Preço de Serviço neste lead" }),
    ).toHaveValue("125,50");
    expect(mocks.updateItemInDeal).toHaveBeenCalledWith(
      "lead-1",
      "item-1",
      { price: 125.5, quantity: 2 },
      { throwOnError: true },
    );
  });
  it("keeps a revised product price while its earlier add is pending", async () => {
    let finish!: (value: unknown) => void;
    mocks.addItemToDeal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Produtos/ }));
    await chooseProduct();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Preço neste lead" }),
      { target: { value: "100" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Preço neste lead" }),
      { target: { value: "130" } },
    );
    await act(async () => finish({ id: "saved" }));
    expect(
      screen.getByRole("textbox", { name: "Preço neste lead" }),
    ).toHaveValue("130");
    expect(screen.queryByText(/Salvo ·/)).toBeNull();
  });
  it("keeps deletion confirmation visible on failure", async () => {
    mocks.deleteDeal.mockRejectedValueOnce(
      new Error("Não foi possível excluir"),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Opções do negócio" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir negócio" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Excluir",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível excluir",
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.addToast).not.toHaveBeenCalledWith(
      "Negócio excluído com sucesso",
      "success",
    );
  });
  it("keeps the real confirmation open and disables duplicate deletion while pending", async () => {
    let reject!: (error: Error) => void;
    mocks.deleteDeal.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Opções do negócio" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir negócio" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Excluir",
      }),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Excluir",
      }),
    ).toBeDisabled();
    await act(async () => reject(new Error("Falha na exclusão")));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Excluir",
      }),
    ).toBeEnabled();
  });
  it("does not close lead B after a pending deletion of keyed lead A succeeds", async () => {
    let finish!: () => void;
    mocks.deleteDeal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    const { rerender } = setup(deal, { onDeleted, onClose });
    fireEvent.click(screen.getByRole("button", { name: "Opções do negócio" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir negócio" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Excluir",
      }),
    );
    rerender(
      <LeadPropertiesPanel
        key="lead-2"
        deal={{ ...deal, id: "lead-2", title: "Lead B" }}
        contact={contact}
        onDeleted={onDeleted}
        onClose={onClose}
      />,
    );
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Lead B" })).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(["title", "value"] as const)(
    "holds saving status until both concurrent saves finish when %s resolves first",
    async (first) => {
      let finishTitle!: () => void;
      let finishValue!: () => void;
      mocks.updateDeal.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishTitle = resolve;
          }),
      );
      mocks.updateDeal.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishValue = resolve;
          }),
      );
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Nome do negócio" }),
        { target: { value: "Novo título" } },
      );
      fireEvent.keyDown(
        screen.getByRole("textbox", { name: "Nome do negócio" }),
        { key: "Enter" },
      );
      fireEvent.click(screen.getByRole("button", { name: /R\$\s*250/ }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Valor do negócio" }),
        { target: { value: "300" } },
      );
      fireEvent.keyDown(
        screen.getByRole("textbox", { name: "Valor do negócio" }),
        { key: "Enter" },
      );
      await act(async () => {
        (first === "title" ? finishTitle : finishValue)();
      });
      expect(screen.getByText("Salvando…")).toBeInTheDocument();
      expect(screen.queryByText(/Salvo ·/)).toBeNull();
      await act(async () => {
        (first === "title" ? finishValue : finishTitle)();
      });
      expect(screen.queryByText("Salvando…")).toBeNull();
      expect(screen.getByText(/Salvo ·/)).toBeInTheDocument();
    },
  );
  it("does not claim saved when one concurrent write succeeds and the other fails", async () => {
    let rejectTitle!: (error: Error) => void;
    let finishValue!: () => void;
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectTitle = reject;
        }),
    );
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishValue = resolve;
        }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "Novo título" },
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
      { key: "Enter" },
    );
    fireEvent.click(screen.getByRole("button", { name: /R\$\s*250/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Valor do negócio" }),
      { target: { value: "300" } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Valor do negócio" }),
      { key: "Enter" },
    );
    await act(async () => finishValue());
    expect(screen.queryByText(/Salvo ·/)).toBeNull();
    await act(async () => rejectTitle(new Error("Título falhou")));
    expect(screen.getByRole("alert")).toHaveTextContent("Título falhou");
    expect(screen.queryByText(/Salvo ·/)).toBeNull();
  });
  it("keeps the failure visible when it arrives before another pending save succeeds", async () => {
    let rejectTitle!: (error: Error) => void;
    let finishValue!: () => void;
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectTitle = reject;
        }),
    );
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishValue = resolve;
        }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lead A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do negócio" }), {
      target: { value: "Novo título" },
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Nome do negócio" }),
      { key: "Enter" },
    );
    fireEvent.click(screen.getByRole("button", { name: /R\$\s*250/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Valor do negócio" }),
      { target: { value: "300" } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Valor do negócio" }),
      { key: "Enter" },
    );
    await act(async () => rejectTitle(new Error("Título falhou")));
    expect(screen.getByText("Salvando…")).toBeInTheDocument();
    await act(async () => finishValue());
    expect(screen.getByRole("alert")).toHaveTextContent("Título falhou");
    expect(screen.queryByText(/Salvo ·/)).toBeNull();
  });
  it("keeps a revised new-tag draft visible after its prior save completes", async () => {
    let finish!: () => void;
    mocks.updateDeal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Tag" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Nome da nova tag" }),
      { target: { value: "Primeira" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Nome da nova tag" }),
      { target: { value: "Segunda" } },
    );
    await act(async () => finish());
    expect(
      screen.getByRole("textbox", { name: "Nome da nova tag" }),
    ).toHaveValue("Segunda");
    expect(screen.queryByText(/Salvo ·/)).toBeNull();
  });
  it("summarizes filled custom fields including zero and false but excluding empty multiselect", () => {
    setup({
      ...deal,
      customFields: { source: "", score: 0, preferences: [], active: false },
    });
    expect(
      screen
        .getByRole("button", { name: /Campos personalizados/ })
        .closest("section"),
    ).toHaveTextContent("2 preenchidos");
  });
});

it("preserves typed standard and nonstandard UTM editing and read-only permissions", async () => {
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: /UTMs/ }));
  fireEvent.click(screen.getByRole("button", { name: "Editar Fonte UTM" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fonte UTM" }), { target: { value: "google" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Fonte UTM" }), { key: "Enter" });
  await waitFor(() => expect(mocks.updateDeal).toHaveBeenCalledWith("lead-1", { customFields: { utm_source: "google" } }, { throwOnError: true }));
  fireEvent.click(screen.getByRole("button", { name: "Editar Extra UTM" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Extra UTM" }), { target: { value: "12" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Extra UTM" }), { key: "Enter" });
  await waitFor(() => expect(mocks.updateDeal).toHaveBeenCalledWith("lead-1", { customFields: { utm_extra: 12 } }, { throwOnError: true }));
  view.unmount(); mocks.edit = false; setup();
  fireEvent.click(screen.getByRole("button", { name: /UTMs/ }));
  expect(screen.getByRole("button", { name: "Editar Fonte UTM" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Editar Extra UTM" })).toBeDisabled();
});
it("orders ungrouped fields before alphabetically sorted named groups", () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: /Campos personalizados/ }));
  const section = screen.getByRole("button", { name: /Campos personalizados/ }).closest("section")!;
  expect(section.textContent!.indexOf("Origem")).toBeLessThan(section.textContent!.indexOf("Análise"));
  expect(section.textContent!.indexOf("Análise")).toBeLessThan(section.textContent!.indexOf("Zebra"));
});
it("preserves deterministic tag palette", () => {
  setup({ ...deal, tags: ["A", "B"] });
  expect(screen.getByText("A")).toHaveClass("bg-amber-50");
  expect(screen.getByText("B")).toHaveClass("bg-emerald-50");
});
it("grows the description with the current draft", () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: "Adicionar descrição..." }));
  const textarea = screen.getByRole("textbox", { name: "Descrição do lead" });
  Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 240 });
  fireEvent.change(textarea, { target: { value: "Long description" } });
  expect(textarea).toHaveStyle({ height: "240px" });
});
it("constrains the shared panel to its available parent width", () => {
  setup();
  expect(screen.getByRole("complementary", { name: "Propriedades do lead" })).toHaveClass("w-full", "max-w-full", "min-w-0");
});
