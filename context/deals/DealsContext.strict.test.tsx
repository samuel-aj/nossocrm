import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DealView } from "@/types";
import { DEALS_VIEW_KEY, queryKeys } from "@/lib/query";
const mocks = vi.hoisted(() => ({
  org: "orgA",
  update: vi.fn(),
  remove: vi.fn(),
  updateItem: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  addToast: vi.fn(),
}));
vi.mock("@/lib/tabOrg", () => ({ readTabOrg: () => ({ id: mocks.org }) }));
vi.mock("../AuthContext", () => ({
  useAuth: () => ({ profile: { id: "user" } }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ addToast: mocks.addToast }),
}));
vi.mock("@/lib/supabase", () => ({
  dealsService: {
    update: mocks.update,
    delete: mocks.remove,
    updateItem: mocks.updateItem,
    addItem: mocks.addItem,
    removeItem: mocks.removeItem,
  },
}));
vi.mock("@/lib/query/hooks/useDealsQuery", () => ({
  useDealsView: () => ({ data: [] }),
}));
import { DealsProvider, useDeals } from "./DealsContext";
const deal = {
  id: "lead",
  title: "Before",
  value: 10,
  items: [
    { id: "item", name: "Item", productId: "product", price: 10, quantity: 1 },
  ],
} as DealView;
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(DEALS_VIEW_KEY, [deal]);
  client.setQueryData(queryKeys.deals.lists(), [deal]);
  client.setQueryData(queryKeys.deals.detail("lead"), deal);
  return {
    client,
    ...renderHook(() => useDeals(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <DealsProvider>{children}</DealsProvider>
        </QueryClientProvider>
      ),
    }),
  };
}
beforeEach(() => {
  mocks.org = "orgA";
  for (const mock of [
    mocks.update,
    mocks.remove,
    mocks.updateItem,
    mocks.addItem,
    mocks.removeItem,
    mocks.addToast,
  ])
    mock.mockReset();
  mocks.update.mockResolvedValue({ error: new Error("failed"), data: null });
  mocks.remove.mockResolvedValue({ error: new Error("failed") });
  mocks.updateItem.mockResolvedValue({ error: new Error("failed") });
  mocks.removeItem.mockResolvedValue({ error: new Error("failed") });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("keeps legacy update resolution and rejects strict update with canonical rollback", async () => {
  const { result, client, unmount } = setup();
  await act(async () => result.current.updateDeal("lead", { title: "After" }));
  await act(async () => {
    await expect(
      result.current.updateDeal(
        "lead",
        { title: "After" },
        { throwOnError: true },
      ),
    ).rejects.toThrow("failed");
  });
  expect(client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0].title).toBe(
    "Before",
  );
  unmount();
  client.clear();
});
it("keeps the delete confirmation possible after failed strict deletion", async () => {
  const { result, client, unmount } = setup();
  await act(async () => result.current.deleteDeal("lead"));
  expect(client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0].id).toBe("lead");
  await act(async () => {
    await expect(
      result.current.deleteDeal("lead", { throwOnError: true }),
    ).rejects.toThrow("failed");
  });
  expect(client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0].id).toBe("lead");
  unmount();
  client.clear();
});
it.each(["updateItem", "removeItem"] as const)(
  "rolls back and rejects strict %s",
  async (method) => {
    const { result, client, unmount } = setup();
    await act(async () => {
      if (method === "updateItem")
        await result.current.updateItemInDeal("lead", "item", { price: 50 });
      else await result.current.removeItemFromDeal("lead", "item");
    });
    await act(async () => {
      await expect(
        method === "updateItem"
          ? result.current.updateItemInDeal(
              "lead",
              "item",
              { price: 50 },
              { throwOnError: true },
            )
          : result.current.removeItemFromDeal("lead", "item", {
              throwOnError: true,
            }),
      ).rejects.toThrow("failed");
    });
    expect(client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0].items).toEqual(
      deal.items,
    );
    unmount();
    client.clear();
  },
);
it("does not restore an old organization snapshot after delayed strict rejection", async () => {
  let finish!: (value: unknown) => void;
  mocks.remove.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, client, unmount } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.deleteDeal("lead", { throwOnError: true });
  });
  mocks.org = "orgB";
  client.setQueryData(DEALS_VIEW_KEY, [{ ...deal, id: "other-org" }]);
  await act(async () => {
    finish({ error: new Error("failed") });
    await expect(pending).rejects.toThrow("failed");
  });
  expect(client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0].id).toBe(
    "other-org",
  );
  unmount();
  client.clear();
});
