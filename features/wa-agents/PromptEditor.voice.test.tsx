import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PromptEditor } from './PromptEditor';

it('marca exatamente a seleção no editor e mostra o erro de fechamento ao editar', () => {
  function Editor() {
    const [value, setValue] = useState('Diga: Tudo bem?');
    const ref = useRef<HTMLTextAreaElement>(null);
    return <PromptEditor value={value} onChange={setValue} textareaRef={ref}
      actions={[]} media={[]} onInsertToken={() => {}} />;
  }
  render(<Editor />);
  const field = screen.getByRole('textbox', { name: 'Roteiro do agente' }) as HTMLTextAreaElement;
  field.setSelectionRange(6, field.value.length);
  fireEvent.click(screen.getByRole('button', { name: 'Marcar trecho como áudio' }));
  expect(field.value).toBe('Diga: [audio]Tudo bem?[/audio]');
  fireEvent.change(field, { target: { value: '[audio]Faltou fechar.' } });
  expect(screen.getByRole('alert').textContent).toContain('[/audio]');
});
