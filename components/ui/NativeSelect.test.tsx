import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { NativeSelect } from './NativeSelect';
import { useForm } from 'react-hook-form';
import { Modal } from './Modal';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

describe('NativeSelect', () => {
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
