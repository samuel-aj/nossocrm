import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { NativeSelect } from './NativeSelect';
import { useForm } from 'react-hook-form';
import { Modal } from './Modal';
import { FormSelect } from './FormControls';
import { FocusTrap } from '@/lib/a11y';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

describe('NativeSelect', () => {
  it('keeps controlled form serialization when its owner rejects closed typeahead', async () => {
    const onChange = vi.fn();
    const { container } = render(<form><NativeSelect name="product" aria-label="Produto" value="a" onChange={onChange}>
      <option value="a">Abacaxi</option><option value="b">Banana</option>
    </NativeSelect></form>);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await act(async () => trigger.focus());
    await userEvent.keyboard('b');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'b' }) }));
    expect(trigger).toHaveTextContent('Abacaxi');
    expect(container.querySelector('select[name="product"]')).toHaveValue('a');
    expect(new FormData(container.querySelector('form')!).get('product')).toBe('a');
  });

  it.each(['default', 'reset', 'setValue', 'typeahead'] as const)('synchronizes RHF %s with the label, native value, blur and submission', async mode => {
    const submit = vi.fn();
    function Form() {
      const { register, handleSubmit, reset, setValue, watch, formState } = useForm({ mode: 'onBlur', defaultValues: { product: mode === 'default' ? 'b' : 'a' } });
      return <form onSubmit={handleSubmit(submit)}>
        <NativeSelect aria-label="Produto" {...register('product')}>
          <option value="a">Abacaxi</option><option value="b">Banana</option>
        </NativeSelect>
        <span data-testid="watched">{watch('product')}</span>
        <span data-testid="touched">{String(Boolean(formState.touchedFields.product))}</span>
        <button type="button" onClick={() => reset({ product: 'b' })}>Resetar</button>
        <button type="button" onClick={() => setValue('product', 'b')}>Definir</button>
        <button type="submit">Enviar</button>
      </form>;
    }
    const { container } = render(<Form />);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    if (mode === 'reset') await userEvent.click(screen.getByText('Resetar'));
    if (mode === 'setValue') await userEvent.click(screen.getByText('Definir'));
    await act(async () => trigger.focus());
    if (mode === 'typeahead') await userEvent.keyboard('b');
    expect(trigger).toHaveTextContent('Banana');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(container.querySelector('select')).toHaveValue('b');
    expect(new FormData(container.querySelector('form')!).get('product')).toBe('b');
    expect(screen.getByTestId('watched')).toHaveTextContent('b');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId('touched')).toHaveTextContent('true'));
    expect(screen.getByTestId('watched')).toHaveTextContent('b');
    expect(trigger).toHaveTextContent('Banana');
    await userEvent.click(screen.getByText('Enviar'));
    expect(submit).toHaveBeenLastCalledWith({ product: 'b' }, expect.anything());
  });

  it.each(['raw', 'nested', 'modal-raw'] as const)('keeps search, keyboard selection and local Escape inside a %s trap', async mode => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const bubblingEscape = vi.fn();
    function Surface() {
      const [drawer, setDrawer] = React.useState(mode === 'raw');
      const contents = <div role="dialog" onKeyDown={event => { if (event.key === 'Escape') bubblingEscape(); }}>
        <button type="button" onClick={() => setDrawer(true)}>Abrir painel</button>
        {drawer && <FocusTrap active initialFocus={false} onEscape={innerClose}>
          <NativeSelect aria-label="Produto" searchable defaultValue="a">
            <option value="a">Laranja</option><option value="b">Uva</option>
          </NativeSelect><button type="button">Próximo</button>
        </FocusTrap>}
      </div>;
      return mode === 'raw' ? contents : mode === 'modal-raw'
        ? <Modal isOpen onClose={outerClose} title="Negócio">{contents}</Modal>
        : <FocusTrap active initialFocus={false} onEscape={outerClose}>{contents}</FocusTrap>;
    }
    render(<Surface />);
    if (mode !== 'raw') await userEvent.click(screen.getByText('Abrir painel'));
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await userEvent.click(trigger);
    const search = screen.getByRole('searchbox');
    expect(trigger.closest('[data-focus-trap-fallback]')).toContainElement(search);
    await userEvent.type(search, 'uva');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('uva');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Uva' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveTextContent('Uva');
    expect(trigger).toHaveFocus();
    for (const fromOption of [false, true]) {
      await userEvent.click(trigger);
      expect(screen.getByRole('searchbox')).toHaveFocus();
      if (fromOption) await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(outerClose).not.toHaveBeenCalled();
      expect(innerClose).not.toHaveBeenCalled();
      expect(bubblingEscape).not.toHaveBeenCalled();
    }
  });

  it('does not mount Radix option nodes while a large menu is closed', async () => {
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    try {
      render(<NativeSelect aria-label="Produto" defaultValue="" searchable>
        <option value="">Nenhum</option>
        {Array.from({ length: 100 }, (_, index) => <option key={index} value={String(index)}>Produto {index}</option>)}
      </NativeSelect>);
      const mountedOptions = () => setAttribute.mock.calls.filter(([name, value]) => name === 'role' && value === 'option').length;
      expect(mountedOptions()).toBe(0);
      await userEvent.click(screen.getByRole('combobox', { name: 'Produto' }));
      expect(mountedOptions()).toBeGreaterThanOrEqual(100);
    } finally {
      setAttribute.mockRestore();
    }
  });

  it('keeps closed-trigger typeahead without opening the list', async () => {
    render(<NativeSelect aria-label="Produto" defaultValue=""><option value="">Nenhum</option><option value="u">Uva</option><option value="l">Laranja</option></NativeSelect>);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    trigger.focus();
    await userEvent.keyboard('u');
    expect(trigger).toHaveTextContent('Uva');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects an empty value and preserves the native change contract', async () => {
    const onChange = vi.fn();
    render(<NativeSelect aria-label="Produto" value="a" onChange={onChange}>
      <option value="">Sem produto</option><option value="a">Produto A</option>
    </NativeSelect>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Produto' }));
    await userEvent.click(screen.getByRole('option', { name: 'Sem produto' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '' }) }));
  });

  it('shows groups and long labels while preventing disabled selections', async () => {
    const onChange = vi.fn();
    render(<NativeSelect aria-label="Responsável" value="" onChange={onChange}>
      <option value="">Sem responsável</option>
      <optgroup label="Equipe"><option value="a" disabled>Indisponível</option><option value="b">Pessoa com nome muito longo para caber em uma coluna estreita</option></optgroup>
    </NativeSelect>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Responsável' }));
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Indisponível' })).toHaveAttribute('data-disabled');
    await userEvent.click(screen.getByRole('option', { name: 'Indisponível' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: /Pessoa com nome muito longo/ })).toBeInTheDocument();
  });

  it('filters locally and restores trigger focus on Escape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<NativeSelect aria-label="Produto" value="" searchable><option value="">Nenhum</option><option value="a">Laranja</option><option value="b">Uva</option></NativeSelect>);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await userEvent.click(trigger);
    await userEvent.type(screen.getByRole('searchbox'), 'uva');
    expect(screen.getByRole('option', { name: 'Uva' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Laranja' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('serializes forms and exposes required validation', async () => {
    const { container } = render(<form><NativeSelect name="product" aria-label="Produto" defaultValue="" required>
      <option value="">Selecione</option><option value="a">Produto A</option>
    </NativeSelect></form>);
    const form = container.querySelector('form')!;
    expect(form.checkValidity()).toBe(false);
    form.reportValidity();
    expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveFocus();
    await userEvent.click(screen.getByRole('combobox', { name: 'Produto' }));
    await userEvent.click(screen.getByRole('option', { name: 'Produto A' }));
    expect(new FormData(form).get('product')).toBe('a');
    expect(form.checkValidity()).toBe(true);
    fireEvent.reset(form);
  });

  it('reads mixed option children and disables whole groups', async () => {
    const onChange = vi.fn();
    render(<NativeSelect aria-label="Serviço" value="" onChange={onChange}>
      <option value="">Nenhum</option>
      <option value="p">{'Plano'} - R$ {120}</option>
      <optgroup label="Indisponíveis" disabled><option value="d">Bloqueado</option></optgroup>
    </NativeSelect>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Serviço' }));
    expect(screen.getByRole('option', { name: 'Plano - R$ 120' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bloqueado' })).toHaveAttribute('data-disabled');
    await userEvent.click(screen.getByRole('option', { name: 'Plano - R$ 120' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'p' }) }));
  });

  it('keeps a real option whose value matches the empty sentinel', async () => {
    const onChange = vi.fn();
    render(<NativeSelect aria-label="Valor" value="" onChange={onChange}><option value="">Nenhum</option><option value="__crm_empty_selection__">Valor real</option></NativeSelect>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Valor' }));
    await userEvent.click(screen.getByRole('option', { name: 'Valor real' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '__crm_empty_selection__' }) }));
  });

  it('resets the displayed value and sends programmatic focus to the trigger', async () => {
    const { container } = render(<form><NativeSelect name="product" aria-label="Produto" defaultValue=""><option value="">Nenhum</option><option value="a">Produto A</option></NativeSelect></form>);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('option', { name: 'Produto A' }));
    expect(trigger).toHaveTextContent('Produto A');
    expect(new FormData(container.querySelector('form')!).get('product')).toBe('a');
    fireEvent.reset(container.querySelector('form')!);
    expect(trigger).toHaveTextContent('Nenhum');
    container.querySelector('select[name="product"]')!.focus();
    expect(trigger).toHaveFocus();
  });

  it('supports keyboard movement from search to options', async () => {
    render(<NativeSelect aria-label="Produto" defaultValue="" searchable><option value="">Nenhum</option><option value="a">Laranja</option><option value="b">Uva</option></NativeSelect>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Produto' }));
    const search = screen.getByRole('searchbox');
    await userEvent.type(search, 'uva');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Uva' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveTextContent('Uva');
  });

  it('works with react-hook-form registration, focus and reset', async () => {
    const submit = vi.fn();
    function Form() {
      const { register, handleSubmit, reset, setFocus, watch } = useForm({ defaultValues: { product: '' } });
      return <form onSubmit={handleSubmit(submit)}>
        <NativeSelect aria-label="Produto" defaultValue="" {...register('product', { required: true })}>
          <option value="">Nenhum</option><option value="a">Produto A</option>
        </NativeSelect>
        <span data-testid="watched">{watch('product')}</span>
        <button type="button" onClick={() => setFocus('product')}>Focar</button>
        <button type="button" onClick={() => reset()}>Limpar</button>
        <button type="submit">Enviar</button>
      </form>;
    }
    render(<Form />);
    await userEvent.click(screen.getByRole('button', { name: 'Focar' }));
    expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveFocus();
    await userEvent.click(screen.getByRole('combobox', { name: 'Produto' }));
    await userEvent.click(screen.getByRole('option', { name: 'Produto A' }));
    expect(screen.getByTestId('watched')).toHaveTextContent('a');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(submit).toHaveBeenCalledWith({ product: 'a' }, expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveTextContent('Nenhum');
    expect(screen.getByTestId('watched')).toBeEmptyDOMElement();
  });

  it('keeps a FormSelect full width within its form column', () => {
    render(<div className="w-80"><FormSelect label="Produto" value="a" onChange={vi.fn()} options={[{ value: 'a', label: 'Produto A' }]} /></div>);
    expect(screen.getByRole('combobox', { name: 'Produto' }).parentElement).toHaveClass('w-full');
  });

  it('fires registered blur after leaving the search portal, not on opening it', async () => {
    function Form() {
      const { register, formState } = useForm({ mode: 'onBlur', defaultValues: { product: '' } });
      return <form><NativeSelect aria-label="Produto" searchable {...register('product', { required: true })}>
        <option value="">Nenhum</option><option value="a">Produto A</option>
      </NativeSelect><button type="button">Próximo</button><span data-testid="touched">{String(Boolean(formState.touchedFields.product))}</span></form>;
    }
    render(<Form />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Produto' }));
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getByTestId('touched')).toHaveTextContent('false');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Próximo' })).toHaveFocus();
    await waitFor(() => expect(screen.getByTestId('touched')).toHaveTextContent('true'));
  });

  it('keeps an only modal field untouched when Tab returns to its trigger', async () => {
    function OnlyField() {
      const { register, formState } = useForm({ mode: 'onBlur', defaultValues: { product: '' } });
      return <Modal isOpen onClose={vi.fn()} title="Seleção"><NativeSelect aria-label="Produto" searchable {...register('product', { required: true })}>
        <option value="">Nenhum</option><option value="a">Produto A</option>
      </NativeSelect><span data-testid="touched">{String(Boolean(formState.touchedFields.product))}</span></Modal>;
    }
    render(<OnlyField />);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await userEvent.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await userEvent.tab();
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(trigger).toHaveFocus();
    expect(screen.getByTestId('touched')).toHaveTextContent('false');
  });

  it('keeps the first field untouched on Shift+Tab and skips portal focus guards', async () => {
    function FirstField() {
      const { register, formState } = useForm({ mode: 'onBlur', defaultValues: { product: '' } });
      return <form><NativeSelect aria-label="Produto" searchable {...register('product', { required: true })}>
        <option value="">Nenhum</option><option value="a">Produto A</option>
      </NativeSelect><span data-testid="touched">{String(Boolean(formState.touchedFields.product))}</span></form>;
    }
    render(<FirstField />);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await userEvent.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await userEvent.tab({ shift: true });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(trigger).toHaveFocus();
    expect(trigger.isConnected).toBe(true);
    expect(screen.getByTestId('touched')).toHaveTextContent('false');
  });


  it('keeps portal focus and tab navigation usable in a modal', async () => {
    render(<Modal isOpen onClose={vi.fn()} title="Seleção"><NativeSelect aria-label="Produto" defaultValue="" searchable>
      <option value="">Nenhum</option><option value="a">Produto A</option>
    </NativeSelect><button type="button">Próximo</button></Modal>);
    const trigger = screen.getByRole('combobox', { name: 'Produto' });
    await userEvent.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    await userEvent.tab();
    expect(document.querySelector('[role="dialog"]')).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await userEvent.tab();
    expect(document.querySelector('[role="dialog"]')).toContainElement(document.activeElement as HTMLElement);
  });
});
