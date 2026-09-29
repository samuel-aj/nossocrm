"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  Maximize2,
  Package,
  Pencil,
  Phone,
  Tag,
  Trash2,
  Undo2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import { useCRM } from "@/context/CRMContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useMyActionPermissions } from "@/lib/permissions/useMyActionPermissions";
import { useOrgMembers, useOrgUsers } from "@/lib/query/hooks";
import { formatPriorityPtBr } from "@/lib/utils/priority";
import type { Contact, CustomFieldDefinition, Deal, DealView } from "@/types";
import { useAcknowledgeAlert } from "@/features/boards/hooks/useAcknowledgeAlert";
import { LossDetailsBanner } from "@/features/deals/LossDetailsBanner";
import { DealStageControl } from "./DealStageControl";
import { FollowupStatus } from "./FollowupStatus";
import { invalidateLeadHistory } from "./leadHistoryInvalidation";

export type LeadPropertiesPanelProps = {
  deal: Deal | DealView;
  contact?: Contact | null;
  onClose?: () => void;
  onDeleted?: () => void;
  onExpand?: () => void;
  side?: "left" | "right";
};

type Section =
  | "business"
  | "contact"
  | "fields"
  | "products"
  | "utms"
  | "details";
const INITIAL_OPEN: Record<Section, boolean> = {
  business: true,
  contact: true,
  fields: false,
  products: false,
  utms: false,
  details: false,
};
const money = (value: number) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const priceText = (value: number) =>
  Number(value || 0).toLocaleString("pt-BR", {
    useGrouping: false,
    maximumFractionDigits: 2,
  });
function parsePrice(raw: string) {
  const normalized = raw
    .trim()
    .replace(/[R$\s]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function fieldDisplay(field: CustomFieldDefinition, value: unknown) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length))
    return "Campo vazio";
  if (field.type === "currency") return money(Number(value));
  if (field.type === "date" && typeof value === "string") {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("pt-BR");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function SectionCard({
  title,
  icon,
  open,
  toggle,
  children,
  summary,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  toggle: () => void;
  children: React.ReactNode;
  summary?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 p-3 text-left text-sm font-bold text-slate-800 dark:text-white focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon}
          {title}
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="px-3 pb-3 text-sm text-slate-800 dark:text-slate-100">
          {children}
        </div>
      ) : (
        summary && (
          <div className="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">
            {summary}
          </div>
        )
      )}
    </section>
  );
}

export function LeadPropertiesPanel({
  deal,
  contact,
  onClose,
  onDeleted,
  onExpand,
  side = "left",
}: LeadPropertiesPanelProps) {
  const crm = useCRM();
  const { organizationId } = useAuth();
  const { addToast } = useToast();
  const client = useQueryClient();
  const permissions = useMyActionPermissions(deal.boardId);
  const { isAdmin: canAssignOwner } = useOrgUsers();
  const { data: members = [] } = useOrgMembers();
  useAcknowledgeAlert(true, deal);
  const identity = `${organizationId}:${deal.id}`;
  const identityRef = useRef(identity);
  const pendingRef = useRef(new Set<string>());
  const cancelledBlurRef = useRef<string | null>(null);
  const defaultProductSuggestedRef = useRef(false);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const [open, setOpen] = useState(INITIAL_OPEN);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [valueDraft, setValueDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [fieldEditor, setFieldEditor] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [customItem, setCustomItem] = useState(false);
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("0");
  const [itemQuantity, setItemQuantity] = useState(1);
  const productDraftRef = useRef({ productId, price, quantity });
  productDraftRef.current = { productId, price, quantity };
  const customItemDraftRef = useRef({ itemName, itemPrice, itemQuantity });
  customItemDraftRef.current = { itemName, itemPrice, itemQuantity };
  const [itemEditor, setItemEditor] = useState<{
    id: string;
    price: string;
    quantity: number;
  } | null>(null);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fieldGroups, setFieldGroups] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const draftRevisionRef = useRef(0);
  useEffect(() => {
    draftRevisionRef.current += 1;
  }, [
    titleDraft,
    valueDraft,
    descriptionDraft,
    fieldEditor,
    productId,
    quantity,
    price,
    itemName,
    itemPrice,
    itemQuantity,
    itemEditor,
    newTag,
  ]);
  const canEdit = permissions.deals.edit;
  const hiddenGroups = new Set(
    crm.boards.find((b) => b.id === deal.boardId)?.hiddenFieldGroups ?? [],
  );
  const fieldDefinitions = crm.customFieldDefinitions.filter(
    (f) =>
      !hiddenGroups.has((f.groupName ?? "").trim()) &&
      !f.key.startsWith("utm_"),
  );
  const groups = new Map<string, CustomFieldDefinition[]>();
  for (const field of fieldDefinitions) {
    const group = (field.groupName ?? "").trim();
    groups.set(group, [...(groups.get(group) ?? []), field]);
  }
  const owner = members.find((m) => m.id === deal.ownerId);
  const productsById = new Map(crm.products.map((p) => [p.id, p]));
  useEffect(() => {
    setOpen(INITIAL_OPEN);
    setTitleDraft(null);
    setValueDraft(null);
    setDescriptionDraft(null);
    setFieldEditor(null);
    setItemEditor(null);
    setProductId("");
    setPrice("");
    setQuantity(1);
    setTagsOpen(false);
    setOptionsOpen(false);
    setOwnerOpen(false);
    setSaving(null);
    setError(null);
    setLastSaved(null);
    const initiallyOpen: Record<string, boolean> = {};
    for (const field of fieldDefinitions) {
      const group = (field.groupName ?? "").trim();
      const value = deal.customFields?.[field.key];
      if (group && value != null && value !== "" && (!Array.isArray(value) || value.length > 0)) initiallyOpen[group] = true;
    }
    setFieldGroups(initiallyOpen);
    defaultProductSuggestedRef.current = false;
  }, [identity]);
  useEffect(() => {
    if (!open.products || defaultProductSuggestedRef.current) return;
    defaultProductSuggestedRef.current = true;
    if (productId) return;
    const defaultId = crm.boards.find(
      (b) => b.id === deal.boardId,
    )?.defaultProductId;
    const product = defaultId ? productsById.get(defaultId) : null;
    if (product && product.active !== false) {
      setProductId(product.id);
      setPrice(priceText(product.price));
    }
  }, [open.products, deal.boardId, productId, crm.boards, crm.products]);
  const toggle = (section: Section) =>
    setOpen((current) => ({ ...current, [section]: !current[section] }));
  const refresh = (org = organizationId, id = deal.id) =>
    invalidateLeadHistory(client, org, id);
  const save = async (
    key: string,
    action: () => Promise<unknown>,
    clear?: () => void,
  ) => {
    const start = identity;
    const draftRevision = draftRevisionRef.current;
    const pendingKey = `${start}:${key}`;
    if (pendingRef.current.has(pendingKey)) return false;
    pendingRef.current.add(pendingKey);
    setError(null);
    setLastSaved(null);
    setSaving(key);
    try {
      const result = await action();
      if (result === null)
        throw new Error("Não foi possível salvar. Seus dados continuam aqui.");
      await refresh(organizationId, deal.id);
      if (identityRef.current === start) {
        clear?.();
        if (draftRevisionRef.current === draftRevision)
          setLastSaved(new Date());
      }
      return true;
    } catch (cause) {
      if (identityRef.current === start)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível salvar. Seus dados continuam aqui.",
        );
      return false;
    } finally {
      pendingRef.current.delete(pendingKey);
      if (identityRef.current === start) setSaving(null);
    }
  };
  const updateDeal = (patch: Partial<Deal>) =>
    crm.updateDeal(deal.id, patch, { throwOnError: true });
  const saveTitle = async () => {
    if (titleDraft === null) return;
    const next = titleDraft.trim();
    if (!next) {
      setError("Digite o nome do negócio.");
      return;
    }
    if (next === deal.title) {
      setTitleDraft(null);
      return;
    }
    await save(
      "title",
      () => updateDeal({ title: next }),
      () =>
        setTitleDraft((current) => (current === titleDraft ? null : current)),
    );
  };
  const saveValue = async () => {
    if (valueDraft === null) return;
    const next = Number(valueDraft);
    if (!valueDraft.trim() || !Number.isFinite(next) || next < 0) {
      setError("Digite um valor válido.");
      return;
    }
    if (next === deal.value) {
      setValueDraft(null);
      return;
    }
    await save(
      "value",
      () => updateDeal({ value: next }),
      () =>
        setValueDraft((current) => (current === valueDraft ? null : current)),
    );
  };
  const saveDescription = async () => {
    if (descriptionDraft === null) return;
    if (descriptionDraft === (deal.description ?? "")) {
      setDescriptionDraft(null);
      return;
    }
    const submitted = descriptionDraft;
    await save(
      "description",
      () => updateDeal({ description: submitted }),
      () =>
        setDescriptionDraft((current) =>
          current === submitted ? null : current,
        ),
    );
  };
  const saveField = async (field: CustomFieldDefinition, raw: string) => {
    let next: unknown = raw.trim() || null;
    if (field.type === "number" || field.type === "currency") {
      if (raw.trim()) {
        const parsed = Number(raw.trim().replace(",", "."));
        if (!Number.isFinite(parsed)) {
          setError(`Valor numérico inválido em "${field.label}".`);
          return;
        }
        next = parsed;
      }
    }
    await save(
      `field:${field.key}`,
      () =>
        updateDeal({
          customFields: { ...(deal.customFields ?? {}), [field.key]: next },
        }),
      () =>
        setFieldEditor((current) =>
          current?.key === field.key && current.value === raw ? null : current,
        ),
    );
  };
  const saveItem = async () => {
    if (!itemEditor) return;
    const parsed = parsePrice(itemEditor.price);
    if (
      parsed === null ||
      !Number.isInteger(itemEditor.quantity) ||
      itemEditor.quantity < 1
    ) {
      setError("Preço ou quantidade inválidos.");
      return;
    }
    const submitted = itemEditor;
    await save(
      "item",
      () =>
        crm.updateItemInDeal(
          deal.id,
          submitted.id,
          { price: parsed, quantity: submitted.quantity },
          { throwOnError: true },
        ),
      () =>
        setItemEditor((current) => (current === submitted ? null : current)),
    );
  };
  const addProduct = async () => {
    const product = productsById.get(productId);
    if (!product) return;
    const parsed = price.trim() ? parsePrice(price) : product.price;
    if (parsed === null || !Number.isInteger(quantity) || quantity < 1) {
      setError("Preço ou quantidade inválidos.");
      return;
    }
    const submitted = { productId, price, quantity };
    await save(
      "product",
      () =>
        crm.addItemToDeal(deal.id, {
          productId: product.id,
          name: product.name,
          price: parsed,
          quantity,
        }),
      () => {
        if (
          productDraftRef.current.productId === submitted.productId &&
          productDraftRef.current.price === submitted.price &&
          productDraftRef.current.quantity === submitted.quantity
        ) {
          setProductId("");
          setPrice("");
          setQuantity(1);
        }
      },
    );
  };
  const addCustomItem = async () => {
    const parsed = parsePrice(itemPrice);
    if (
      !itemName.trim() ||
      parsed === null ||
      !Number.isInteger(itemQuantity) ||
      itemQuantity < 1
    ) {
      setError("Digite nome, preço e quantidade válidos.");
      return;
    }
    const submitted = { itemName, itemPrice, itemQuantity };
    await save(
      "customItem",
      () =>
        crm.addItemToDeal(deal.id, {
          productId: "",
          name: itemName.trim(),
          price: parsed,
          quantity: itemQuantity,
        }),
      () => {
        if (
          customItemDraftRef.current.itemName === submitted.itemName &&
          customItemDraftRef.current.itemPrice === submitted.itemPrice &&
          customItemDraftRef.current.itemQuantity === submitted.itemQuantity
        ) {
          setItemName("");
          setItemPrice("0");
          setItemQuantity(1);
          setCustomItem(false);
        }
      },
    );
  };
  const changeTag = async (tag: string, remove = false) => {
    const normalized = tag.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const tags = remove
      ? deal.tags.filter((value) => value !== normalized)
      : [...(deal.tags ?? []), normalized];
    if (
      !remove &&
      deal.tags.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
    )
      return;
    if (
      (await save(
        "tags",
        () => updateDeal({ tags }),
        () => {
          setTagsOpen(false);
          setNewTag("");
        },
      )) &&
      !remove &&
      !crm.availableTags.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
    )
      crm.addTag(normalized);
  };
  const row = (field: CustomFieldDefinition) => {
    const editing = fieldEditor?.key === field.key;
    const value = deal.customFields?.[field.key];
    return (
      <div
        key={field.id}
        className="border-t border-slate-100 dark:border-white/5 py-2"
      >
        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
          {field.label}
        </label>
        {editing && canEdit ? (
          field.type === "multiselect" ? (
            <div className="space-y-1">
              {field.options?.map((option) => (
                <label key={option} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={Array.isArray(value) && value.includes(option)}
                    onChange={() => {
                      const current = Array.isArray(value) ? value : [];
                      void save(`field:${field.key}`, () =>
                        updateDeal({
                          customFields: {
                            ...(deal.customFields ?? {}),
                            [field.key]: current.includes(option)
                              ? current.filter(
                                  (item: string) => item !== option,
                                )
                              : [...current, option],
                          },
                        }),
                      );
                    }}
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : field.type === "select" ? (
            <select
              autoFocus
              aria-label={field.label}
              value={fieldEditor.value}
              onChange={(event) => {
                setFieldEditor({ key: field.key, value: event.target.value });
                void saveField(field, event.target.value);
              }}
              className="w-full rounded-lg border border-primary-400 bg-white dark:bg-slate-900 p-2"
            >
              <option value="">Selecione...</option>
              {field.options?.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              aria-label={field.label}
              type={field.type === "date" ? "date" : "text"}
              inputMode={
                field.type === "currency" || field.type === "number"
                  ? "decimal"
                  : undefined
              }
              value={fieldEditor.value}
              onChange={(event) => {
                setFieldEditor({ key: field.key, value: event.target.value });
                if (field.type === "date")
                  void saveField(field, event.target.value);
              }}
              onBlur={() => {
                if (cancelledBlurRef.current === `field:${field.key}`) {
                  cancelledBlurRef.current = null;
                  return;
                }
                if (field.type !== "date")
                  void saveField(field, fieldEditor.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  void saveField(field, fieldEditor.value);
                if (event.key === "Escape") {
                  event.stopPropagation();
                  cancelledBlurRef.current = `field:${field.key}`;
                  setFieldEditor(null);
                }
              }}
              className="w-full rounded-lg border border-primary-400 bg-white dark:bg-slate-900 p-2"
            />
          )
        ) : (
          <button
            type="button"
            aria-label={`Editar ${field.label}`}
            disabled={!canEdit}
            onClick={() =>
              setFieldEditor({
                key: field.key,
                value: value == null ? "" : String(value),
              })
            }
            className="w-full text-left text-sm hover:text-primary-600 disabled:cursor-default"
          >
            {fieldDisplay(field, value)}
          </button>
        )}
      </div>
    );
  };
  return (
    <aside
      aria-label="Propriedades do lead"
      className="flex h-full min-h-0 flex-col bg-slate-50/70 dark:bg-slate-900/50 text-slate-900 dark:text-white"
    >
      <div className="shrink-0 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-4 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {titleDraft !== null ? (
              <input
                autoFocus
                aria-label="Nome do negócio"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  if (cancelledBlurRef.current === "title") {
                    cancelledBlurRef.current = null;
                    return;
                  }
                  void saveTitle();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveTitle();
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancelledBlurRef.current = "title";
                    setTitleDraft(null);
                  }
                }}
                className="w-full rounded border border-primary-400 p-1 text-lg font-bold bg-white dark:bg-slate-900"
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setTitleDraft(deal.title)}
                className="text-left text-lg font-bold font-display hover:text-primary-600 disabled:cursor-default"
              >
                {deal.title}
              </button>
            )}
          </div>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              aria-label="Expandir"
              className="p-1 text-slate-500 hover:text-primary-600"
            >
              <Maximize2 size={16} />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              aria-label="Opções do negócio"
              aria-expanded={optionsOpen}
              onClick={() => setOptionsOpen(!optionsOpen)}
              className="p-1 text-slate-500 hover:text-primary-600"
            >
              •••
            </button>
            {optionsOpen && (
              <div
                className={`absolute ${side === "right" ? "right-0" : "left-0"} z-20 w-40 rounded-lg border bg-white dark:bg-slate-800 shadow-lg p-1`}
              >
                <button
                  type="button"
                  disabled={!permissions.deals.delete}
                  onClick={() => {
                    setDeleteOpen(true);
                    setOptionsOpen(false);
                  }}
                  className="flex items-center gap-2 w-full rounded p-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  <Trash2 size={14} /> Excluir negócio
                </button>
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar propriedades"
              className="p-1 text-slate-500 hover:text-slate-900"
            >
              <X size={17} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(deal.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="rounded border border-primary-200 bg-primary-50 dark:bg-primary-500/10 px-1.5 py-0.5 text-xs text-primary-700 dark:text-primary-300"
            >
              {tag}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void changeTag(tag, true)}
                  aria-label={`Remover tag ${tag}`}
                  className="ml-1"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setTagsOpen(!tagsOpen)}
                className="text-xs text-primary-600 dark:text-primary-400"
              >
                + Tag
              </button>
              {tagsOpen && (
                <div className="absolute z-20 top-6 left-0 w-56 rounded-lg border bg-white dark:bg-slate-800 shadow-lg p-2 space-y-1">
                  <select
                    aria-label="Selecionar etiqueta"
                    className="w-full bg-white dark:bg-slate-800 p-1 text-xs"
                    value=""
                    onChange={(event) => void changeTag(event.target.value)}
                  >
                    <option value="">Selecionar etiqueta</option>
                    {crm.availableTags
                      .filter(
                        (value) =>
                          !deal.tags.some(
                            (tag) => tag.toLowerCase() === value.toLowerCase(),
                          ),
                      )
                      .map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                  </select>
                  <input
                    aria-label="Nome da nova tag"
                    placeholder="Nova etiqueta"
                    value={newTag}
                    onChange={(event) => setNewTag(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void changeTag(newTag);
                    }}
                    className="w-full rounded border p-1 text-xs bg-white dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => void changeTag(newTag)}
                    className="text-xs text-primary-600"
                  >
                    Criar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <DealStageControl deal={deal} size="sm" />
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {saving && (
          <p role="status" className="text-xs text-slate-500">
            Salvando…
          </p>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-3 space-y-3">
        <LossDetailsBanner key={deal.id} deal={deal} canEdit={canEdit} />
        {deal.status && (
          <FollowupStatus dealId={deal.id} stageId={deal.status} />
        )}
        {deal.inactiveAt && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
            <strong className="flex gap-1 items-center">
              <Archive size={14} /> Em Inativos
            </strong>
            <p>
              Devolução automática ao funil em{" "}
              {Math.max(
                0,
                30 -
                  Math.floor(
                    (Date.now() - new Date(deal.inactiveAt).getTime()) /
                      86_400_000,
                  ),
              )}{" "}
              dias.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() =>
                  void save("reactivate", async () => {
                    await updateDeal({ inactiveAt: null });
                    if (contact?.status === "INACTIVE")
                      await crm.updateContact(
                        contact.id,
                        { status: "ACTIVE" },
                        { throwOnError: true },
                      );
                  })
                }
                className="text-amber-700 dark:text-amber-300 font-semibold flex gap-1 items-center"
              >
                <Undo2 size={13} /> Devolver agora
              </button>
            )}
          </div>
        )}
        {!deal.inactiveAt && contact?.status === "INACTIVE" && (
          <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 text-sm">
            <strong>Em Inativos</strong>
            <p>O contato está com status INATIVO.</p>
            {canEdit && (
              <button
                type="button"
                onClick={() =>
                  void save("reactivate", () =>
                    crm.updateContact(
                      contact.id,
                      { status: "ACTIVE" },
                      { throwOnError: true },
                    ),
                  )
                }
                className="text-primary-600 font-semibold"
              >
                Reativar contato e devolver
              </button>
            )}
          </div>
        )}
        <SectionCard
          title="Negócio"
          icon={<Building2 size={16} />}
          open={open.business}
          toggle={() => toggle("business")}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-xs text-slate-500">Valor</span>
              {valueDraft !== null ? (
                <input
                  autoFocus
                  aria-label="Valor do negócio"
                  inputMode="decimal"
                  value={valueDraft}
                  onChange={(event) => setValueDraft(event.target.value)}
                  onBlur={() => {
                    if (cancelledBlurRef.current === "value") {
                      cancelledBlurRef.current = null;
                      return;
                    }
                    void saveValue();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveValue();
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      cancelledBlurRef.current = "value";
                      setValueDraft(null);
                    }
                  }}
                  className="w-full border-b border-primary-400 bg-transparent"
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setValueDraft(String(deal.value))}
                  className="font-semibold text-primary-600 disabled:cursor-default"
                >
                  {money(deal.value)}
                </button>
              )}
            </div>
            <div className="relative">
              <span className="block text-xs text-slate-500">Responsável</span>
              <button
                type="button"
                aria-label="Responsável pelo lead"
                disabled={!canAssignOwner}
                onClick={() => setOwnerOpen(!ownerOpen)}
                className="font-medium text-left disabled:cursor-default"
              >
                {owner?.name ??
                  (deal.ownerId ? "Usuário removido" : "Sem responsável")}
              </button>
              {ownerOpen && (
                <div className="absolute z-20 right-0 top-10 w-52 max-h-60 overflow-auto rounded-lg border bg-white dark:bg-slate-800 shadow-lg p-1">
                  {[
                    { id: "", name: "Sem responsável" },
                    ...members.filter((m) => m.member),
                  ].map((member) => (
                    <button
                      type="button"
                      key={member.id}
                      onClick={() =>
                        void save(
                          "owner",
                          () => updateDeal({ ownerId: member.id }),
                          () => setOwnerOpen(false),
                        )
                      }
                      className="block w-full text-left rounded p-2 text-sm hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      {member.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <span className="block text-xs text-slate-500">Prioridade</span>
            <span>{formatPriorityPtBr(deal.priority)}</span>
          </div>
          <div className="mt-3 border-t border-slate-100 dark:border-white/10 pt-3">
            <span className="block text-xs text-slate-500">Descrição</span>
            {descriptionDraft !== null ? (
              <textarea
                autoFocus
                aria-label="Descrição do lead"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={() => {
                  if (cancelledBlurRef.current === "description") {
                    cancelledBlurRef.current = null;
                    return;
                  }
                  void saveDescription();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancelledBlurRef.current = "description";
                    setDescriptionDraft(null);
                  }
                }}
                className="w-full min-h-16 rounded-lg border bg-white dark:bg-slate-900 p-2"
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setDescriptionDraft(deal.description ?? "")}
                className="w-full text-left text-sm text-slate-700 dark:text-slate-200 disabled:cursor-default"
              >
                {deal.description || "Adicionar descrição..."}
              </button>
            )}
          </div>
        </SectionCard>
        <SectionCard
          title="Contato"
          icon={<User size={16} />}
          open={open.contact}
          toggle={() => toggle("contact")}
        >
          {contact ? (
            <div className="space-y-2">
              <a
                href={`/contacts?contactId=${contact.id}`}
                className="flex items-center gap-1 text-primary-600 dark:text-primary-400"
              >
                <User size={14} /> {contact.name} <ExternalLink size={12} />
              </a>
              {contact.phone && (
                <div className="flex gap-2 items-center">
                  <Phone size={13} /> {contact.phone}
                  <button
                    type="button"
                    aria-label="Copiar telefone"
                    onClick={() => {
                      void navigator.clipboard.writeText(contact.phone);
                      addToast("Telefone copiado!", "success");
                    }}
                  >
                    <Copy size={13} />
                  </button>
                </div>
              )}
              {contact.email && (
                <div className="flex gap-2 items-center">
                  <span>{contact.email}</span>
                  <button
                    type="button"
                    aria-label="Copiar email"
                    onClick={() => {
                      void navigator.clipboard.writeText(contact.email);
                      addToast("Email copiado!", "success");
                    }}
                  >
                    <Copy size={13} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p>Sem contato</p>
          )}
          <div className="mt-3 flex gap-2">
            <span className="text-slate-500">Empresa</span>
            <span>{"companyName" in deal ? deal.companyName || "—" : "—"}</span>
          </div>
        </SectionCard>
        <SectionCard
          title="Campos personalizados"
          icon={<Tag size={16} />}
          open={open.fields}
          toggle={() => toggle("fields")}
          summary={
            fieldDefinitions.length
              ? `${fieldDefinitions.length} campo${fieldDefinitions.length === 1 ? "" : "s"}`
              : undefined
          }
        >
          {fieldDefinitions.length === 0 ? (
            <p className="text-slate-500">Nenhum campo personalizado</p>
          ) : (
            [...groups.entries()].map(([name, fields]) =>
              name ? (
                <div
                  key={name}
                  className="border-t border-slate-100 dark:border-white/10"
                >
                  <button
                    type="button"
                    aria-expanded={!!fieldGroups[name]}
                    onClick={() =>
                      setFieldGroups((current) => ({
                        ...current,
                        [name]: !current[name],
                      }))
                    }
                    className="w-full flex justify-between py-2 text-xs font-bold text-slate-500"
                  >
                    <span className="flex gap-1 items-center">
                      <FolderOpen size={13} />
                      {name} ({fields.length})
                    </span>
                    <ChevronDown size={14} />
                  </button>
                  {fieldGroups[name] && fields.map(row)}
                </div>
              ) : (
                fields.map(row)
              ),
            )
          )}
        </SectionCard>
        <SectionCard
          title={`Produtos (${deal.items?.length ?? 0})`}
          icon={<Package size={16} />}
          open={open.products}
          toggle={() => toggle("products")}
        >
          {!deal.items?.length && (
            <p className="text-xs text-slate-500 mb-2">
              Nenhum produto. O valor do negócio é manual.
            </p>
          )}
          {deal.items?.map((item) => (
            <div
              key={item.id}
              className="border-t border-slate-100 dark:border-white/10 py-2"
            >
              <div className="flex justify-between gap-2">
                <strong className="font-medium">{item.name}</strong>
                <span>{money(item.price * item.quantity)}</span>
              </div>
              {itemEditor?.id === item.id ? (
                <div className="flex gap-2 mt-1">
                  <input
                    aria-label={`Preço de ${item.name} neste lead`}
                    value={itemEditor.price}
                    onChange={(event) =>
                      setItemEditor({
                        ...itemEditor,
                        price: event.target.value,
                      })
                    }
                    className="w-24 rounded border p-1 bg-white dark:bg-slate-900"
                  />
                  <input
                    aria-label={`Quantidade de ${item.name}`}
                    type="number"
                    min="1"
                    value={itemEditor.quantity}
                    onChange={(event) =>
                      setItemEditor({
                        ...itemEditor,
                        quantity: Number(event.target.value),
                      })
                    }
                    className="w-14 rounded border p-1 bg-white dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => void saveItem()}
                    aria-label={`Salvar ${item.name}`}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setItemEditor(null)}
                    aria-label="Cancelar edição"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 items-center text-xs">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setItemEditor({
                        id: item.id,
                        price: priceText(item.price),
                        quantity: item.quantity,
                      })
                    }
                    className="text-primary-600 disabled:cursor-default"
                  >
                    {item.quantity} × {money(item.price)}{" "}
                    <Pencil size={11} className="inline" />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        void save("removeItem", () =>
                          crm.removeItemFromDeal(deal.id, item.id, {
                            throwOnError: true,
                          }),
                        )
                      }
                      aria-label={`Remover ${item.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="mt-3 space-y-2">
              <select
                aria-label="Produto ou serviço"
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value);
                  setPrice(
                    priceText(productsById.get(event.target.value)?.price ?? 0),
                  );
                }}
                className="w-full rounded border bg-white dark:bg-slate-900 p-2"
              >
                <option value="">Adicionar produto ou serviço...</option>
                {crm.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} - {money(product.price)}
                  </option>
                ))}
              </select>
              {productId && (
                <div className="flex gap-2">
                  <input
                    aria-label="Quantidade"
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(event) =>
                      setQuantity(Number(event.target.value))
                    }
                    className="w-14 rounded border p-1 bg-white dark:bg-slate-900"
                  />
                  <input
                    aria-label="Preço neste lead"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    className="min-w-0 flex-1 rounded border p-1 bg-white dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => void addProduct()}
                    className="text-primary-600 font-semibold"
                  >
                    Adicionar
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCustomItem(!customItem)}
                className="text-xs text-primary-600"
              >
                {customItem
                  ? "Fechar item personalizado"
                  : "Item personalizado (fora do catálogo)"}
              </button>
              {customItem && (
                <div className="space-y-1">
                  <input
                    aria-label="Nome do item"
                    placeholder="Nome do item"
                    value={itemName}
                    onChange={(event) => setItemName(event.target.value)}
                    className="w-full rounded border p-1 bg-white dark:bg-slate-900"
                  />
                  <div className="flex gap-2">
                    <input
                      aria-label="Preço"
                      value={itemPrice}
                      onChange={(event) => setItemPrice(event.target.value)}
                      className="min-w-0 flex-1 rounded border p-1 bg-white dark:bg-slate-900"
                    />
                    <input
                      aria-label="Quantidade do item"
                      type="number"
                      min="1"
                      value={itemQuantity}
                      onChange={(event) =>
                        setItemQuantity(Number(event.target.value))
                      }
                      className="w-14 rounded border p-1 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => void addCustomItem()}
                      className="text-primary-600 font-semibold"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>
        <SectionCard
          title="UTMs"
          icon={<Tag size={16} />}
          open={open.utms}
          toggle={() => toggle("utms")}
        >
          {(["source", "medium", "campaign", "content", "term"] as const).map(
            (name) => (
              <div key={name} className="flex justify-between gap-2 py-1">
                <span className="text-slate-500">
                  {name[0].toUpperCase() + name.slice(1)}
                </span>
                <span className="truncate">
                  {deal.customFields?.[`utm_${name}`] || "—"}
                </span>
              </div>
            ),
          )}
        </SectionCard>
        <SectionCard
          title="Detalhes"
          icon={<FolderOpen size={16} />}
          open={open.details}
          toggle={() => toggle("details")}
          summary={`Criado em ${new Date(deal.createdAt).toLocaleDateString("pt-BR")} · Probabilidade ${deal.probability}%`}
        >
          <div className="flex justify-between">
            <span>Criado em</span>
            <span>{new Date(deal.createdAt).toLocaleString("pt-BR")}</span>
          </div>
          <div className="flex justify-between">
            <span>Probabilidade</span>
            <span>{deal.probability}%</span>
          </div>
        </SectionCard>
      </div>
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!permissions.deals.delete) return;
          void save(
            "delete",
            () => crm.deleteDeal(deal.id, { throwOnError: true }),
            () => {
              setDeleteOpen(false);
              onDeleted?.();
              onClose?.();
              addToast("Negócio excluído com sucesso", "success");
            },
          );
        }}
        title="Excluir Negócio"
        message="Tem certeza que deseja excluir este negócio? Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="danger"
      />
      <div className="shrink-0 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card px-3 py-2 min-h-8 text-xs text-slate-500 dark:text-slate-400">
        {lastSaved && !error && (
          <span
            role="status"
            className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
          >
            <Check size={13} /> Salvo ·{" "}
            {lastSaved.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </aside>
  );
}
