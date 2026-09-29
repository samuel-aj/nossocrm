'use client';

import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const EMPTY = '__crm_empty_selection__';

type Option = { value: string; label: string; disabled: boolean; group?: string };

function optionText(children: React.ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return React.Children.toArray(children).map(child => React.isValidElement<{ children?: React.ReactNode }>(child) ? optionText(child.props.children) : optionText(child)).join('');
}

function readOptions(children: React.ReactNode, group?: string, groupDisabled = false): Option[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement(child)) return [];
    if (child.type === React.Fragment) return readOptions((child.props as { children?: React.ReactNode }).children, group, groupDisabled);
    if (child.type === 'optgroup') {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      return readOptions(props.children, props.label, groupDisabled || Boolean(props.disabled));
    }
    if (child.type !== 'option') return [];
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label = props.label ?? optionText(props.children);
    return [{ value: props.value === undefined ? label : String(props.value), label, disabled: groupDisabled || Boolean(props.disabled), group }];
  });
}

export type NativeSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'> & {
  /** Search only among the options already supplied as children. */
  searchable?: boolean;
  /** Text shown when the selected value has no matching option. */
  placeholder?: string;
};

/** JSX-compatible single select for existing native select call sites. */
export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect({
  children, value, defaultValue, onChange, onBlur, className, searchable = false,
  placeholder = 'Selecione', disabled, name, required, id, autoFocus, form,
  ...props
}, forwardedRef) {
  const options = useMemo(() => readOptions(children), [children]);
  const showSearch = searchable || options.length >= 12;
  const initial = String(defaultValue ?? options.find(option => !option.disabled)?.value ?? '');
  const [internalValue, setInternalValue] = useState(initial);
  const selected = value === undefined ? internalValue : String(value);
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingTabRef = useRef<HTMLElement | null>(null);
  const blurSentRef = useRef(false);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const sentinel = useMemo(() => {
    let candidate = EMPTY;
    while (options.some(option => option.value === candidate)) candidate += '_';
    return candidate;
  }, [options]);

  useEffect(() => {
    if (open && showSearch) {
      // Radix focuses its selected item during portal mount; move focus after that step.
      const timeout = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(timeout);
    }
    if (!open) setSearch('');
  }, [open, showSearch]);
  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);
  useLayoutEffect(() => {
    // React may see unchanged option props after an imperative write. Restore
    // the committed value as well when a controlled owner rejects a change.
    const option = selectRef.current?.options[0];
    if (option) { option.value = selected; option.selected = true; }
  });
  useEffect(() => {
    const native = selectRef.current;
    const owner = native?.form;
    if (!owner || value !== undefined) return;
    const reset = () => setInternalValue(initial);
    owner.addEventListener('reset', reset);
    return () => owner.removeEventListener('reset', reset);
  }, [value, initial]);

  const setRefs = useCallback((node: HTMLSelectElement | null) => {
    selectRef.current = node;
    if (node) {
      Object.defineProperty(node, 'focus', { configurable: true, value: () => triggerRef.current?.focus() });
      // Registration libraries write directly to ref.value for defaults, reset
      // and setValue. Keep the sole native option valid *before* they read it
      // back, then update the visible uncontrolled value on the next render.
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
      Object.defineProperty(node, 'value', {
        configurable: true,
        get: () => descriptor.get!.call(node),
        set: (next: string) => {
          const normalized = String(next ?? '');
          node.options[0].value = normalized;
          descriptor.set!.call(node, normalized);
          if (value === undefined) setInternalValue(normalized);
        },
      });
    }
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef, value]);
  const emitRegisteredBlur = () => {
    if (!onBlur || blurSentRef.current) return;
    blurSentRef.current = true;
    const native = selectRef.current;
    if (native) onBlur({ target: native, currentTarget: native, type: 'blur' } as React.FocusEvent<HTMLSelectElement>);
  };
  const handleWidgetBlur = (event: React.FocusEvent<HTMLElement>) => {
    if (!onBlur) return;
    const next = event.relatedTarget as Node | null;
    if (next && (triggerRef.current?.contains(next) || contentRef.current?.contains(next))) return;
    window.setTimeout(() => {
      if (pendingTabRef.current) return;
      const focused = document.activeElement;
      if (focused && (triggerRef.current?.contains(focused) || contentRef.current?.contains(focused))) return;
      emitRegisteredBlur();
    }, 0);
  };
  const change = (next: string) => {
    if (value === undefined) setInternalValue(next);
    const native = selectRef.current;
    if (native) {
      native.value = next;
      const target = { value: next, name: native.name, type: native.type };
      onChange?.({ target, currentTarget: target, type: 'change' } as React.ChangeEvent<HTMLSelectElement>);
      // A controlled owner can reject the change without rendering again.
      // Its next accepted prop remains authoritative for native form reads.
      if (value !== undefined) {
        native.options[0].value = selected;
        native.options[0].selected = true;
      }
    }
  };
  const resetTypeahead = () => {
    typeaheadRef.current = '';
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = null;
  };
  const handleClosedTypeahead = (key: string) => {
    const search = typeaheadRef.current + key;
    typeaheadRef.current = search;
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(resetTypeahead, 1000);
    const normalized = search.length > 1 && Array.from(search).every(char => char === search[0]) ? search[0] : search;
    const enabled = options.filter(option => !option.disabled);
    const currentIndex = Math.max(0, enabled.findIndex(option => option.value === selected));
    const ordered = [...enabled.slice(currentIndex), ...enabled.slice(0, currentIndex)];
    const candidates = normalized.length === 1 ? ordered.filter(option => option.value !== selected) : ordered;
    const match = candidates.find(option => option.label.toLocaleLowerCase().startsWith(normalized.toLocaleLowerCase()));
    if (match) change(match.value);
  };
  const visible = showSearch && search.trim()
    ? options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : options;
  const visibleValues = new Set(visible.map(option => option.value));
  const current = options.find(option => option.value === selected);
  const radixValue = selected === '' ? sentinel : selected;
  const wrapperWidth = className?.split(/\s+/).filter(token => /^(?:[a-z]+:)?(?:w-|min-w-|max-w-|flex-|shrink-)/.test(token)).join(' ');
  const optionGroups = options.reduce<{ group?: string; options: Option[] }[]>((groups, option) => {
    const last = groups[groups.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else groups.push({ group: option.group, options: [option] });
    return groups;
  }, []);
  // Keep open items stable while filtering: unmounting the selected item makes
  // Radix refocus the list and interrupts typing. Hidden items cannot be reached
  // by either Radix navigation or the search input's Arrow/Enter handlers.
  const renderItem = (option: Option, index: number) => <Select.Item key={`${option.value}:${index}`} value={option.value === '' ? sentinel : option.value} hidden={!visibleValues.has(option.value)} style={!visibleValues.has(option.value) ? { display: 'none' } : undefined} disabled={option.disabled || !visibleValues.has(option.value)} textValue={option.label} className="relative flex min-h-9 cursor-pointer select-none items-center rounded-lg py-2 pl-2 pr-8 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-primary-50 data-[highlighted]:text-primary-700 data-[state=checked]:font-semibold dark:data-[highlighted]:bg-primary-500/15 dark:data-[highlighted]:text-primary-300">
    <Select.ItemText><span className="block whitespace-normal break-words" title={option.label}>{option.label}</span></Select.ItemText>
    <Select.ItemIndicator className="absolute right-2 text-primary-600 dark:text-primary-400"><Check size={15} /></Select.ItemIndicator>
  </Select.Item>;

  return <span className={cn('relative inline-flex min-w-0', wrapperWidth)}>
    <select
      ref={setRefs} tabIndex={-1} aria-hidden="true" name={name} required={required} disabled={disabled}
      form={form} value={selected} onChange={onChange ?? (() => {})}
      onInvalid={event => { event.preventDefault(); triggerRef.current?.focus(); props.onInvalid?.(event); }}
      className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
    >
      <option value={selected}>{current?.label ?? selected}</option>
    </select>
    <Select.Root value={radixValue} open={open} onOpenChange={next => {
      if (next) {
        // Portals belong to the innermost trap, including raw/nested drawer
        // traps. The fixed Popper still escapes scrolling panel contents.
        setPortalContainer(triggerRef.current?.closest<HTMLElement>('[data-focus-trap-fallback]') ?? null);
        resetTypeahead();
      }
      setOpen(next);
    }} onValueChange={next => {
      // Radix's unnamed native form mirror has no options while closed and
      // reports ''. Actual empty choices use our nonempty sentinel instead.
      if (next !== '') change(next === sentinel ? '' : next);
    }} disabled={disabled}>
      <Select.Trigger
        {...(props as React.ComponentPropsWithoutRef<typeof Select.Trigger>)} id={id} ref={triggerRef} aria-required={required || props['aria-required']}
        className={cn('group flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500/20 data-[state=open]:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-slate-900 dark:text-slate-100', className)}
        onFocus={event => { blurSentRef.current = false; props.onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>); }}
        onBlur={handleWidgetBlur}
        onKeyDown={event => {
          props.onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLSelectElement>);
          if (event.defaultPrevented || open || disabled || event.ctrlKey || event.altKey || event.metaKey) return;
          if (event.key.length === 1 && (event.key !== ' ' || typeaheadRef.current)) {
            event.preventDefault();
            handleClosedTypeahead(event.key);
          }
        }}
      >
        <Select.Value placeholder={placeholder}>{current?.label ?? placeholder}</Select.Value>
        <Select.Icon asChild><ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" /></Select.Icon>
      </Select.Trigger>
      {open && <Select.Portal container={portalContainer}>
        <Select.Content ref={contentRef} onFocusCapture={() => { blurSentRef.current = false; }} onBlurCapture={handleWidgetBlur}
          // Radix receives Escape in document capture. Keep its dismissal and
          // focus return, but do not forward Escape to containing dialogs.
          onEscapeKeyDown={event => event.stopPropagation()}
          onCloseAutoFocus={event => {
            const next = pendingTabRef.current;
            if (!next) return;
            event.preventDefault();
            window.setTimeout(() => {
              const target = next.isConnected && !next.closest('[data-radix-popper-content-wrapper]') ? next : triggerRef.current;
              target?.focus();
              pendingTabRef.current = null;
              const focused = document.activeElement;
              if (focused && !triggerRef.current?.contains(focused) && !contentRef.current?.contains(focused)) emitRegisteredBlur();
            }, 0);
          }}
          position="popper" sideOffset={5} collisionPadding={12} className="z-[10050] max-h-[min(360px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-[min(220px,calc(100vw-24px))] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl dark:border-white/15 dark:bg-slate-900 dark:text-slate-100">
          {showSearch && <div className="relative mb-1.5 flex items-center gap-2 border-b border-slate-200 px-2 pb-1.5 dark:border-white/15" onPointerDown={event => event.stopPropagation()}>
            <Search size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
            <input ref={searchRef} type="search" aria-label="Buscar opções" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                const enabled = Array.from(viewportRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])') ?? []);
                (event.key === 'ArrowDown' ? enabled[0] : enabled[enabled.length - 1])?.focus();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                const first = visible.find(option => !option.disabled);
                if (first) { change(first.value); setOpen(false); triggerRef.current?.focus(); }
              } else if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                const trigger = triggerRef.current;
                const scope = trigger?.closest('[role="dialog"]') ?? document;
                const focusables = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(element => {
                  if (contentRef.current?.contains(element) || element.hasAttribute('data-radix-focus-guard')) return false;
                  if (element.hidden || element.getAttribute('aria-hidden') === 'true' || element.tabIndex < 0 || element.matches(':disabled')) return false;
                  const style = window.getComputedStyle(element);
                  return style.display !== 'none' && style.visibility !== 'hidden';
                });
                const position = trigger ? focusables.indexOf(trigger) : -1;
                const next = focusables[position + (event.shiftKey ? -1 : 1)] ?? trigger;
                pendingTabRef.current = next;
                setOpen(false);
              } else if (event.key !== 'Escape') event.stopPropagation();
            }} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" placeholder="Buscar..." />
          </div>}
          <Select.Viewport ref={viewportRef} className="max-h-72 overflow-y-auto">
            {optionGroups.map((block, index) => block.group
              ? <Select.Group key={`${block.group}:${index}`} hidden={!block.options.some(option => visibleValues.has(option.value))}>
                  <Select.Label className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{block.group}</Select.Label>
                  {block.options.map(renderItem)}
                </Select.Group>
              : <React.Fragment key={`options:${index}`}>{block.options.map(renderItem)}</React.Fragment>)}
            {visible.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Nenhuma opção encontrada</div>}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>}
    </Select.Root>
  </span>;
});
