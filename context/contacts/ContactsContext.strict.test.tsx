import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Contact } from "@/types";
import { queryKeys } from "@/lib/query";
const mocks = vi.hoisted(() => ({ org: "orgA", update: vi.fn() }));
vi.mock("@/lib/tabOrg", () => ({ readTabOrg: () => ({ id: mocks.org }) }));
vi.mock("../AuthContext", () => ({
  useAuth: () => ({ profile: { id: "user" } }),
}));
vi.mock("@/lib/supabase", () => ({
  contactsService: { update: mocks.update },
  companiesService: {},
}));
vi.mock("@/lib/query/hooks/useContactsQuery", () => ({
  useContacts: () => ({ data: [] }),
  useCompanies: () => ({ data: [] }),
}));
import { ContactsProvider, useContacts } from "./ContactsContext";
const contact = { id: "contact", name: "Maria", status: "ACTIVE" } as Contact;
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.contacts.lists(), [contact]);
  return {
    client,
    ...renderHook(() => useContacts(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ContactsProvider>{children}</ContactsProvider>
        </QueryClientProvider>
      ),
    }),
  };
}
beforeEach(() => {
  mocks.org = "orgA";
  mocks.update
    .mockReset()
    .mockResolvedValue({ error: new Error("contact failed") });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("retains legacy resolution and rejects strict contact update with rollback", async () => {
  const { result, client, unmount } = setup();
  await act(async () =>
    result.current.updateContact("contact", { status: "INACTIVE" }),
  );
  await act(async () => {
    await expect(
      result.current.updateContact(
        "contact",
        { status: "INACTIVE" },
        { throwOnError: true },
      ),
    ).rejects.toThrow("contact failed");
  });
  expect(
    client.getQueryData<Contact[]>(queryKeys.contacts.lists())?.[0].status,
  ).toBe("ACTIVE");
  unmount();
  client.clear();
});
it("does not restore another organization after an old update fails", async () => {
  let finish!: (value: unknown) => void;
  mocks.update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, client, unmount } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.updateContact(
      "contact",
      { status: "INACTIVE" },
      { throwOnError: true },
    );
    await Promise.resolve();
  });
  mocks.org = "orgB";
  client.setQueryData(queryKeys.contacts.lists(), [
    { ...contact, id: "other-org" },
  ]);
  await act(async () => {
    finish({ error: new Error("contact failed") });
    await expect(pending).rejects.toThrow("contact failed");
  });
  expect(
    client.getQueryData<Contact[]>(queryKeys.contacts.lists())?.[0].id,
  ).toBe("other-org");
  unmount();
  client.clear();
});
