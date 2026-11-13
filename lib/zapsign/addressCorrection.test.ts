import { describe, expect, it } from 'vitest';
import { addressCorrectionComponent, applyAddressCorrection } from './addressCorrection';

describe('correção localizada no endereço já apresentado', () => {
  const address = 'Rua das Acácias, 88, Vila Nova, Campo Grande MS';
  const corrected = 'Rua das Acácias, 98, Vila Nova, Campo Grande MS';

  it.each([
    'o número da casa tá errado, é 98 e não 88',
    'o número da casa não é 88, é 98',
    'Troque o número de 88 para 98.',
    'Pode gerar, mas o número da casa é 98, não 88',
    'Número da casa é 98',
  ])('corrige só o número: %s', text => {
    expect(addressCorrectionComponent(text)).toBe('Número da casa');
    expect(applyAddressCorrection(address, text)).toBe(corrected);
  });

  it('edita só a parte identificada, inclusive em endereço rural, retendo nome, CEP e complemento', () => {
    const source = 'Estrada 88, km 88, nº 88, apto 88, Sítio Acácias, CEP 56300';
    expect(applyAddressCorrection(source, 'Número da casa é 98 e não 88')).toBe(
      'Estrada 88, km 88, nº 98, apto 88, Sítio Acácias, CEP 56300');
    expect(applyAddressCorrection('Rua 88, 88, Centro, Recife PE', 'número da casa é 98')).toBe(
      'Rua 88, 98, Centro, Recife PE');
    expect(applyAddressCorrection('Sítio Primavera, km 88, Petrolina PE, CEP 56300', 'número da casa é 98')).toBeNull();
    expect(applyAddressCorrection('Rua Um, 88, Rua Dois, 88', 'número da casa é 98')).toBeNull();
  });

  it('não confunde dados pessoais ou de outra pessoa com o número', () => {
    for (const text of ['O número do CPF está errado, é 98 e não 88', 'O número do telefone é 98',
      'O número da casa do representante tá errado, é 98 e não 88', 'Pode gerar', 'tá tudo certo']) {
      expect(applyAddressCorrection(address, text)).toBeUndefined();
    }
    expect(applyAddressCorrection(address, 'número do apartamento tá errado, é 98')).toBeNull();
    expect(applyAddressCorrection(address, 'o número do CEP é 56300')).toBe(address + ', CEP 56300');
  });

  it('reserva números sem rótulo para o chamador identificar o campo da pergunta', () => {
    expect(applyAddressCorrection(address, 'não é 88, é 98')).toBeUndefined();
    expect(applyAddressCorrection(address, 'é 98 e não 88')).toBeUndefined();
    expect(applyAddressCorrection(address, 'Número da casa não é 88, é 98')).toBe(corrected);
    expect(applyAddressCorrection('Estrada da Serra, km 88, Petrolina/PE', 'Número da casa é 98 e não 88')).toBeNull();
  });

  it('adiciona componentes explícitos a uma ficha parcial sem confundir bairros já registrados', () => {
    expect(applyAddressCorrection('Rua das Flores', 'sim, o bairro é Centro')).toBe('Rua das Flores, Bairro Centro');
    expect(applyAddressCorrection('Rua das Flores, 12', 'O bairro é Centro')).toBe('Rua das Flores, 12, Bairro Centro');
    expect(applyAddressCorrection('Estrada do Sol, km 8', 'O CEP correto é 56300')).toBe('Estrada do Sol, km 8, CEP 56300');
    expect(applyAddressCorrection('Rua das Flores, 12, Vila Nova', 'O bairro é Centro')).toBeNull();
  });

  it('troca o logradouro explicitamente corrigido e conserva o número e os demais componentes', () => {
    expect(applyAddressCorrection(address, 'a rua está errada, é Rua das Flores')).toBe(address.replace('Rua das Acácias', 'Rua das Flores'));
    expect(applyAddressCorrection('Rua 88, 114, Centro', 'O logradouro não é Rua 88, é Avenida Brasil')).toBe('Avenida Brasil, 114, Centro');
    expect(applyAddressCorrection('Rua das Acácias nº 88, Centro', 'O logradouro é Rua das Flores')).toBe('Rua das Flores nº 88, Centro');
    expect(applyAddressCorrection('Rua das Acácias 88, Centro', 'A rua está errada')).toBeNull();
    expect(applyAddressCorrection(address, 'O endereço do representante está errado, é Rua das Flores')).toBeUndefined();
  });

  it('identifica número junto ao logradouro sem substituir número de rua, CEP ou complemento', () => {
    for (const street of ['Rua das Acácias 88', 'Rua das Acácias nº 88', 'Av. Brasil número 88']) {
      expect(applyAddressCorrection(street + ', apto 88, CEP 56300', 'Número da casa é 98')).toBe(
        street.replace('88', '98') + ', apto 88, CEP 56300');
    }
    expect(applyAddressCorrection('Rua 88, 114, Vila Nova', 'O número da casa é 98 e não 88')).toBeNull();
    expect(applyAddressCorrection('Rua das Acácias 88, 114, Vila Nova', 'O número da casa é 98 e não 88')).toBeNull();
    expect(applyAddressCorrection('Estrada da Serra km 88, Vila Nova', 'O número da casa é 98')).toBeNull();
  });

  it.each(['o número da casa tá errado', 'número da casa é 98 ou 99', 'acho que o número é 98',
    'O número é 98, não 99', 'Posso trocar o número para 98?', 'o número da casa é 98, mas ainda tenho dúvidas',
    'Não troque o número de 88 para 98', 'não é para mudar o número, é 98 e não 88'])(
    'pede esclarecimento para %s', text => expect(applyAddressCorrection(address, text)).toBeNull(),
  );

  it('corrige componentes textuais e CEP, conservando a grafia indicada', () => {
    const full = address + ', CEP 79000-000';
    expect(applyAddressCorrection(full, 'O bairro não é Vila Nova, é Pôr do Sol')).toBe(full.replace('Vila Nova', 'Pôr do Sol'));
    expect(applyAddressCorrection(full, 'A cidade é Ponta Porã')).toBe(full.replace('Campo Grande', 'Ponta Porã'));
    expect(applyAddressCorrection(full, 'O CEP correto é 79021234')).toBe(full.replace('79000-000', '79021-234'));
    expect(applyAddressCorrection(full, 'O CEP é 56300')).toBe(full.replace('79000-000', '56300'));
  });
});
