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
