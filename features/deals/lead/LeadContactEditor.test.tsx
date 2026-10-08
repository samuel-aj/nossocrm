import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadContactEditor } from "./LeadContactEditor";

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/query/hooks", () => ({ useContactsPaginated: mocks.query }));

const contacts = [
  { id: "cintia", name: "Cíntia", phone: "+5569999991111", email: "cintia@example.com" },
  { id: "joao", name: "João", phone: "+556798671148", email: "joao@example.com" },
];
const result = {
  data: { data: contacts, hasMore: false },
  isLoading: false,
  isError: false,
  isPlaceholderData: false,
  refetch: mocks.refetch,
};
beforeEach(() => {
  mocks.query.mockReset().mockReturnValue(result);
  mocks.refetch.mockReset();
});

describe("LeadContactEditor", () => {
  it("requires explicit selection and save, and cancel does not persist", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<LeadContactEditor currentContactId="cintia" onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: /Cíntia/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar contato" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /João/ }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar contato" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the selected contact available to retry after a failed save", async () => {
    let resolve: (value: boolean) => void;
    const onSave = vi.fn().mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    render(<LeadContactEditor currentContactId="cintia" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /João/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar contato" }));
    expect(onSave).toHaveBeenCalledWith(contacts[1]);
    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await act(async () => resolve!(false));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível trocar o contato");
    expect(screen.getByRole("button", { name: "Salvar contato" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /João/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("searches on the server and hides previous results while the query changes", async () => {
    render(<LeadContactEditor currentContactId="cintia" onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Buscar contato/ }), { target: { value: "(67) 9867-1148" } });
    expect(screen.queryByRole("button", { name: /João/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Buscando contatos");
    await waitFor(() => expect(mocks.query).toHaveBeenLastCalledWith(
      { pageIndex: 0, pageSize: 10 }, { search: "(67) 9867-1148", excludeDeleted: true },
    ));
  });

  it("does not present a search error as no contacts, and permits retry", () => {
    mocks.query.mockReturnValue({ ...result, isError: true, data: undefined });
    render(<LeadContactEditor currentContactId="cintia" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível buscar os contatos");
    expect(screen.queryByText("Nenhum contato encontrado.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("fetches subsequent result pages", () => {
    mocks.query.mockReturnValue({ ...result, data: { data: contacts, hasMore: true } });
    render(<LeadContactEditor currentContactId="cintia" onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Próximos" }));
    expect(mocks.query).toHaveBeenLastCalledWith({ pageIndex: 1, pageSize: 10 }, { search: "", excludeDeleted: true });
  });
});
