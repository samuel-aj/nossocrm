import { describe, expect, it } from 'vitest';
import {
  addressHasCustomerEvidence, contractPersonalField, contractPersonalValueKey, cpfHasCustomerEvidence,
  formatContractAddress, formatContractCpf, sameContractPersonalValue,
} from './contractPersonalFields';

describe('personal contract fields', () => {
  it('recognizes contact field aliases without confusing representatives or commercial terms', () => {
    for (const label of ['Endereço Completo', 'ENDEREÇO RESIDENCIAL DO CLIENTE', 'Endereço rural do titular']) {
      expect(contractPersonalField(label)).toBe('address');
    }
    for (const label of ['Nº do CPF', 'CPF do contratante', 'NÚMERO CPF CLIENTE']) {
      expect(contractPersonalField(label)).toBe('cpf');
    }
    for (const label of ['CPF do representante', 'CPF/CNPJ', 'Endereço do escritório', 'valor do CPF', 'CEP']) {
      expect(contractPersonalField(label)).toBeUndefined();
    }
  });

  it('formats the same eleven digits including leading zeroes and never pads, repairs or truncates', () => {
    expect(formatContractCpf('001.222.333.44')).toBe('001.222.333-44');
    expect(sameContractPersonalValue('cpf', '00122233344', '001.222.333.44')).toBe(true);
    expect(sameContractPersonalValue('cpf', '00122233344', '001.222.333.43')).toBe(false);
    expect(formatContractCpf('001.222.333')).toBeUndefined();
    expect(formatContractCpf('XX001.222.333-44')).toBeUndefined();
    expect(formatContractCpf('01.222.333/0001-67')).toBeUndefined();
    expect(contractPersonalValueKey('cpf', '   ')).toBeUndefined();
  });

  it('accepts a stated CPF or a complete contiguous set of dictated groups', () => {
    const cpf = '001.222.333-44';
    expect(cpfHasCustomerEvidence(cpf, ['Meu CPF é 001.222.333.44, certo?'])).toBe(true);
    expect(cpfHasCustomerEvidence(cpf, ['00122233344'])).toBe(true);
    expect(cpfHasCustomerEvidence(cpf, ['CPF: zero zero um', 'dois dois dois', 'três três três', 'quatro quatro'])).toBe(true);
    expect(cpfHasCustomerEvidence(cpf, ['001', '222', '333', '44'])).toBe(true);
    expect(cpfHasCustomerEvidence(cpf, ['CPF 001', 'CEP 222', '333', '44'])).toBe(false);
    expect(cpfHasCustomerEvidence(cpf, ['Meu telefone é 00122233344'])).toBe(false);
    expect(cpfHasCustomerEvidence(cpf, ['CPF 0012223334433'])).toBe(false);
    expect(cpfHasCustomerEvidence(cpf, ['001', '222', 'confere?', '333', '44'])).toBe(false);
  });

  it('normalizes labelled postal codes only and preserves rural and incomplete addresses', () => {
    expect(formatContractAddress('Rua do Sol, CEPE 13, 732, 439')).toBe('Rua do Sol, CEP 13732-439');
    expect(formatContractAddress('Rua do Sol, CEP: 13732439')).toBe('Rua do Sol, CEP 13732-439');
    expect(formatContractAddress('Sítio Pátio, CEP 56200')).toBe('Sítio Pátio, CEP 56200');
    expect(formatContractAddress('Rua do Sol, 13, 732, 439')).toBe('Rua do Sol, 13, 732, 439');
    expect(formatContractAddress('Rua do Sol, CEP 13, 7')).toBe('Rua do Sol, CEP 13, 7');
    expect(formatContractAddress('CEP 123456789')).toBe('CEP 123456789');
  });

  it('reconciles punctuation, accents, known state and postal-code formatting', () => {
    const address = 'Sítio Jardim, zona rural, Petrolina, Pernambuco, CEP 56300';
    expect(sameContractPersonalValue('address', address, 'Sitio Jardim – zona rural, PETROLINA/PE, CEP 56300')).toBe(true);
    expect(sameContractPersonalValue('address', address, address.replace('56300', '56300-000'))).toBe(false);
    expect(sameContractPersonalValue('address', address, address.replace('Jardim', 'Jardins'))).toBe(false);
    expect(sameContractPersonalValue('address', 'Rua Minas Gerais, 10', 'Rua MG, 10')).toBe(false);
    expect(sameContractPersonalValue('address', 'Rua Pará, 10', 'Rua PA, 10')).toBe(false);
    expect(sameContractPersonalValue('address', 'Rua das Flores, 8, Belém, Pará', 'Rua das Flores, 8, Belém/PA')).toBe(true);
    expect(contractPersonalValueKey('address', '')).toBeUndefined();
  });

  it('recognizes confirmed rural components received out of order, including an explicitly partial CEP', () => {
    const messages = ['O CEP daqui é 56300. Moro em Petrolina, Pernambuco.', 'É no Sítio Jardim, na zona rural.'];
    expect(addressHasCustomerEvidence('Sítio Jardim, zona rural, Petrolina/PE, CEP 56300', messages)).toBe(true);
    expect(addressHasCustomerEvidence('Sítio Jardim, Petrolina/PE', ['Pernambuco', 'Fico no sítio Jardim', 'Petrolina'])).toBe(true);
    expect(addressHasCustomerEvidence('Sítio Jardim, zona rural, Petrolina/PE, CEP 56300-999', messages)).toBe(false);
    expect(addressHasCustomerEvidence('Sítio Jardim, zona rural, Petrolina/PE, casa 6', messages)).toBe(false);
    expect(addressHasCustomerEvidence('Rua do Sol, 120, Centro', ['Bairro é Centro, Rua do Sol. Meu CPF termina em 120.'])).toBe(false);
    expect(addressHasCustomerEvidence('Rua do Sol, 120, Centro', ['Rua do Sol, Centro', 'Quanto ao CPF, o número é 120.'])).toBe(false);
    expect(addressHasCustomerEvidence('Rua do Sol, 120, Centro', ['Bairro é Centro, Rua do Sol.', 'O número da rua é 120.'])).toBe(true);
    expect(addressHasCustomerEvidence('Rua do Sol, 120, Centro', ['Moro na Rua do Sol, 120, no Centro'])).toBe(true);
    expect(addressHasCustomerEvidence('Rua do Sol, CEP 12345', ['Rua do Sol', 'O total foi 12345'])).toBe(false);
  });
});
