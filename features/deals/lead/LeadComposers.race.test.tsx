import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NoteComposer } from './LeadComposers';
it('does not clear newer text when an older save completes', async () => {
 let finish: () => void;
 const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
 const change = vi.fn();
 const { rerender } = render(<NoteComposer value="first" onChange={change} onSave={save} />);
 fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
 rerender(<NoteComposer value="second" onChange={change} onSave={save} />);
 await act(async () => finish());
 expect(change).not.toHaveBeenCalled();
});

it('does not invoke a stale clear after its composer unmounts', async () => {
 let finish: () => void;
 const change = vi.fn();
 const save = () => new Promise<void>(resolve => { finish = resolve; });
 const view = render(<NoteComposer value="old" onChange={change} onSave={save} />);
 fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
 view.unmount();
 const next = render(<NoteComposer value="new" onChange={change} onSave={save} />);
 await act(async () => finish());
 expect(change).not.toHaveBeenCalled();
 next.unmount();
});
