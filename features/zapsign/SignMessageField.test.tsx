import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignMessageField } from './SignMessageField';

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <SignMessageField id="msg" value={value} onChange={setValue} sample={{ nome: 'Marina Exemplo', documento: 'Contrato - Marina Exemplo', titulo: 'Lead da Marina' }} />;
}

describe('SignMessageField', () => {
  it('mostra a prévia com os dados do cliente e o link como etiqueta', () => {
    render(<Harness initial='Olá {{primeiro_nome}}, segue "{{documento}}": {{link}}' />);
    const preview = screen.getByLabelText('Assim o cliente recebe');
    expect(preview).toHaveTextContent('Olá Marina, segue "Contrato - Marina Exemplo": link de assinatura');
    expect(screen.queryByText(/não tem o link/)).toBeNull();
  });

  it('os botões inserem a variável no ponto do cursor', () => {
    render(<Harness initial="Olá, segue o contrato" />);
    const box = screen.getByRole('textbox', { name: 'Mensagem no WhatsApp' }) as HTMLTextAreaElement;
    box.setSelectionRange(3, 3);
    fireEvent.select(box);
    fireEvent.click(screen.getByRole('button', { name: 'Primeiro nome' }));
    expect(box).toHaveValue('Olá {{primeiro_nome}}, segue o contrato');
    // o cursor fica logo depois do que entrou; o próximo entra ali, sem espaço antes da vírgula
    fireEvent.click(screen.getByRole('button', { name: 'Link de assinatura' }));
    expect(box).toHaveValue('Olá {{primeiro_nome}} {{link}}, segue o contrato');
  });

  it('sem mexer no campo, a variável entra no fim', () => {
    render(<Harness initial="Segue o contrato" />);
    fireEvent.click(screen.getByRole('button', { name: 'Link de assinatura' }));
    expect(screen.getByRole('textbox', { name: 'Mensagem no WhatsApp' })).toHaveValue('Segue o contrato {{link}}');
  });

  it('sem {{link}} avisa que o link vai no final; variável desconhecida fica marcada', () => {
    render(<Harness initial="Oi {{primeiro_nome}}, seu {{cpf}}" />);
    expect(screen.getByText(/não tem o link, então ele vai no final/)).toBeInTheDocument();
    expect(screen.getByTitle(/não conhece/)).toHaveTextContent('{{cpf}}');
    expect(screen.getByLabelText('Assim o cliente recebe')).toHaveTextContent('link de assinatura');
  });

  it('mensagem vazia mostra a padrão na prévia', () => {
    render(<Harness initial="" />);
    expect(screen.getByLabelText('Assim o cliente recebe')).toHaveTextContent('Olá Marina, segue o documento "Contrato - Marina Exemplo" para assinatura eletrônica: link de assinatura');
  });
});
