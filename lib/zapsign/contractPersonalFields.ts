import { normalizeVarName } from './variables';

export type ContractPersonalField = 'address' | 'cpf';

export function contractPersonalField(label: string): ContractPersonalField | undefined {
  // A representative's or office's details may appear alongside the customer's.
  const key = normalizeVarName(label).replace(/(?:do|da|de)?(?:cliente|contratante|signatari[oa]|outorgante|titular|contato)$/, '');
  if (/^(?:(?:numero|n)(?:do)?)?cpf$|^cadastrodepessoafisica$/.test(key)) return 'cpf';
  if (/^endereco(?:completo|residencial|rural){0,2}$/.test(key)) return 'address';
}

export function formatContractCpf(value: string): string | undefined {
  const input = value.trim();
  if (!/^[\d.\s-]+$/u.test(input)) return;
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 11) return;
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

const spokenDigits: Record<string, string> = {
  zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5',
  seis: '6', meia: '6', sete: '7', oito: '8', nove: '9',
};
const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function cpfHasCustomerEvidence(cpf: string, messages: readonly string[]): boolean {
  const target = formatContractCpf(cpf);
  if (!target) return false;
  const targetDigits = target.replace(/\D/g, '');
  let fragments: string[] = [];
  let identified = false;
  for (const message of messages) {
    const words = fold(message).trim();
    const label = /\bcpf\s*(?:(?:e|eh|numero)\b\s*)?[:=-]?\s*/u.exec(words);
    if (label) {
      fragments = [];
      identified = true;
    }
    const text = (label ? words.slice(label.index + label[0].length) : words)
      .replace(/\b[a-z]+\b/g, word => Object.hasOwn(spokenDigits, word) ? spokenDigits[word] : word);
    const part = (label ? text.match(/^([\d\s.,-]*\d)(?=$|[\s.,;!?])/u)?.[1] ?? '' : text.replace(/[.!]$/u, '')).trim();
    const digits = /^[\d\s.,-]+$/.test(part) ? part.replace(/\D/g, '') : '';
    if (!digits) {
      if (!(label && !text)) identified = false;
      fragments = [];
      continue;
    }
    if (digits === targetDigits) return true;
    if (digits.length > 11) {
      fragments = [];
      identified = false;
      continue;
    }
    fragments.push(digits);
    const combined = fragments.join('');
    if ((identified || fragments.map(f => f.length).join('-') === '3-3-3-2') && formatContractCpf(combined) === target) return true;
    if (combined.length >= 11) {
      fragments = [];
      identified = false;
    }
  }
  return false;
}

export function formatContractAddress(value: string): string {
  return value.trim().replace(/\s*[\r\n]+\s*/gu, ', ').replace(/\s+/gu, ' ').replace(
    /\bcepe?\b(?:\s+(?:daqui|da (?:rua|casa)|do (?:endereço|local)))?(?:\s+(?:é|eh))?\s*[:=-]?\s*(\d(?:[\d\s.,-]*\d)?)/giu,
    (original, number: string) => {
      // Only recombine recognizable, explicitly labelled postal-code groups.
      // Five digits may intentionally be the entire answer in a rural address.
      if (/^\d{1,7}$/u.test(number)) return 'CEP ' + number;
      if (!/^(?:\d{8}|\d{5}[ -]\d{3}|\d{2}\s*[, .]\s*\d{3}\s*[, .]\s*\d{3})$/u.test(number)) return original;
      return 'CEP ' + number.replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2');
    });
}

const states: Record<string, string> = {
  acre: 'ac', alagoas: 'al', amapa: 'ap', amazonas: 'am', bahia: 'ba', ceara: 'ce',
  'distrito federal': 'df', 'espirito santo': 'es', goias: 'go', maranhao: 'ma',
  'mato grosso do sul': 'ms', 'mato grosso': 'mt', 'minas gerais': 'mg',
  paraiba: 'pb', parana: 'pr', pernambuco: 'pe', piaui: 'pi', 'rio de janeiro': 'rj',
  'rio grande do norte': 'rn', 'rio grande do sul': 'rs', rondonia: 'ro', roraima: 'rr',
  'santa catarina': 'sc', 'sao paulo': 'sp', sergipe: 'se', tocantins: 'to',
};
const stateNames = new RegExp('\\b(?:' + Object.keys(states).join('|') + ')\\b', 'g');
const cityStateSeparator = new RegExp('\\s*[/–-]\\s*(?=(?:' +
  [...Object.values(states), 'pa'].join('|') + ')\\s*(?:[,;]|$))', 'giu');

function addressWords(text: string): string {
  // A state can also be a street or district name. Only shorten the geographic
  // component; "Rua Minas Gerais" and "Rua MG" are different street names.
  const place = /\b(?:rua|r\.|av\.|avenida|bairro|sitio|estrada|travessa|alameda|rodovia|praca|vila|distrito|fazenda|municipio|cidade)(?:\s+(?:de|do|da))?\s*$/u;
  const formatted = formatContractAddress(text);
  const value = fold(formatted.replace(/\bpará(?!\p{L})/giu, (state, offset: number) =>
    place.test(fold(formatted.slice(0, offset))) ? state : 'pa'));
  return value.replace(stateNames, (state, offset: number) =>
    place.test(value.slice(0, offset)) ? state : states[state])
    .replace(/\bav\.(?=\s)/g, 'avenida').replace(/\br\.(?=\s)/g, 'rua')
    .replace(/\bs\s*\/\s*n\b/g, 'sem numero').replace(/\bn[º°](?=\s*\d)/gu, 'numero ')
    .replace(/\b(bairro|cidade|estado)\s+(?:e|eh)(?=\s)/g, '$1')
    .replace(/\b(\d{5})-(\d{3})\b/g, '$1$2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function contractPersonalValueKey(field: ContractPersonalField, value: string): string | undefined {
  if (field === 'cpf') return formatContractCpf(value);
  return addressWords(value) || undefined;
}

export function sameContractPersonalValue(field: ContractPersonalField, a: string, b: string): boolean {
  const first = contractPersonalValueKey(field, a);
  return !!first && first === contractPersonalValueKey(field, b);
}

export function addressHasCustomerEvidence(address: string, messages: readonly string[]): boolean {
  const addressText = formatContractAddress(address);
  if (!/\p{L}/u.test(addressText)) return false;
  // City and UF often arrive as two answers and appear as "cidade/UF" on the ficha.
  const segments = addressText.replace(cityStateSeparator, ',').split(/[,;\n]+/u).map(addressWords).filter(Boolean);
  const evidence = messages.map(message => ' ' + addressWords(message) + ' ');
  if (!segments.length || segments.length > 16) return false;
  return segments.every((segment, index) => {
    const phrase = ' ' + segment + ' ';
    if (!/^\d+$/.test(segment)) return evidence.some(line => line.includes(phrase));
    // A zip code, phone, age or CPF ending does not supply a house number.
    const previous = segments[index - 1];
    const house = previous && /^(?:rua|avenida|travessa|estrada|sitio|rodovia|alameda|praca)\b/.test(previous);
    const labelled = new RegExp('\\bnumero(?: da (?:casa|rua))?(?: e)? ' + segment + ' ');
    return evidence.some(line => {
      if (line === phrase || (house && line.includes(' ' + previous + phrase))) return true;
      // "O número é 110" can describe a house. "O número do meu CPF é 110"
      // or "meu CPF, o número é 110" cannot supply the house number.
      if (/\b(?:cpf|cnpj|cep|rg|telefone|celular|whatsapp|documento)\b/u.test(line)) {
        return line.includes(' numero da casa e ' + segment + ' ') || line.includes(' numero da rua e ' + segment + ' ');
      }
      return labelled.test(line);
    });
  });
}
