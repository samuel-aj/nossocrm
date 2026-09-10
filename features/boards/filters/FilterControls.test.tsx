import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterSelect } from './FilterControls';
describe('filter dropdown', () => {
  beforeEach(() => { cleanup(); Element.prototype.scrollIntoView = vi.fn(); });
  it('supports clearing a product to the empty all-products value', async () => {
    const onChange = vi.fn();
    render(<FilterSelect label="Produto" value="one" onChange={onChange} options={[{value:'',label:'Todos os produtos'},{value:'one',label:'Produto 1'}]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Produto 1');
    fireEvent.keyDown(screen.getByRole('combobox'), {key:'Enter'});
    fireEvent.click(await screen.findByRole('option', {name:'Todos os produtos'}));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
