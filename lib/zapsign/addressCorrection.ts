import { formatContractAddress } from './contractPersonalFields';

const components = {
  'Número da casa': /\bn[uú]mero(?: d[ao] (?:casa|rua|im[oó]vel|endere[çc]o|resid[eê]ncia))?\b/iu,
  CEP: /\bcep\b/iu,
  Bairro: /\bbairro\b/iu,
  Cidade: /\b(?:cidade|munic[ií]pio)\b/iu,
  Logradouro: /\b(?:logradouro|rua|avenida|travessa|estrada|rodovia)\b/iu,
} as const;

type Component = keyof typeof components;
const fold = (text: string) => text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const componentsOf = (message: string) => {
  const words = fold(message);
  const explicitHouse = /\bnumero d[ao] (?:casa|rua|imovel|endereco|residencia)\b/u.test(words);
  return (Object.keys(components) as Component[]).filter(component => {
    if (!components[component].test(message)) return false;
    if (component === 'Logradouro' && (explicitHouse ||
        /\b(?:cep|bairro|cidade|municipio)\b/u.test(words) &&
        !/\b(?:a rua|a estrada|o logradouro) (?:esta|ta) (?:errad[oa]|incorret[oa])\b/u.test(words))) return false;
    // "Número do CEP" and "número do telefone" don't identify a house.
    if (component === 'Número da casa' && !explicitHouse &&
        /\b(?:cep|cpf|rg|cnpj|celular|telefone|whatsapp|processo|protocolo|documento|apartamento|apto|lote|quadra|km|bloco)\b/u.test(words)) return false;
    return true;
  });
};

export function addressCorrectionComponent(message: string): Component | undefined {
  const fields = componentsOf(message);
  return fields.length === 1 ? fields[0] : undefined;
}

type Replacement = { value: string; old?: string };
const houseValue = /^\d{1,6}[a-z]?$/iu;
const cepValue = /^\d{5}(?:[- ]?\d{3})?$/u;
const placeName = /^[\p{L}][\p{L}\p{N}'’ -]{0,69}$/u;

function replacement(component: Component, message: string): Replacement | undefined {
  const label = components[component].exec(message)!;
  let tail = message.slice(label.index + label[0].length).trim().replace(/[.!]+$/u, '').trim();
  tail = tail.replace(/^(?:(?:est[aá]|t[aá]|ficou|estava|veio)\s+)?(?:errad[oa]|incorret[oa])\b[.,;: -]*/iu, '');
  tail = tail.replace(/^(?:na verdade[, ]+|o (?:certo|correto) [eé] |o correto seria )/iu, '');
  const oldFirst = tail.match(/^(?:de |era )(.+?)(?: para | pra |,\s*agora [eé] )(.+)$/iu)
    ?? tail.match(/^n[aã]o [eé] (.+?)(?:,?\s+(?:[eé] sim |e sim |mas [eé] |[eé] ))(.+)$/iu);
  const valueFirst = tail.match(/^(?:[eé] )?(.+?)(?:,?\s+(?:e n[aã]o|n[aã]o|em vez de|ao inv[eé]s de)) (.+)$/iu);
  const result: Replacement = oldFirst ? { old: oldFirst[1], value: oldFirst[2] }
    : valueFirst ? { value: valueFirst[1], old: valueFirst[2] }
    : { value: tail.replace(/^(?:(?:corret[oa]|cert[oa]) )?(?:[eé] |para |pra |: *)/iu, '') };

  const valid = component === 'Número da casa' ? houseValue : component === 'CEP' ? cepValue : placeName;
  if (!valid.test(result.value) || (result.old && !valid.test(result.old))) return;
  // An unrestricted sentence after "bairro" is not a place name.
  if (valid === placeName &&
      (!/^(?:de |era |n[aã]o [eé] |[eé] |:|(?:corret[oa]|cert[oa]) [eé] )/iu.test(tail) ||
       /\b(?:nao|errad[oa]|certo|errad[oa]s|acho|talvez|quero|precis[oa]|pode|ou|confirma|mudou|corrigir)\b/u.test(fold(result.value)))) return;
  return result;
}

const street = /^(?:rua|r\.|avenida|av\.|travessa|estrada|alameda|praca|rodovia|via)\s/u;
const houseSegment = /^(\s*(?:(?:n[uú]mero|n[°º.]|casa)\s*[:.-]?\s*)?)(\d{1,6}[A-Z]?)(\s*)$/iu;
const postalSegment = /^(\s*CEP\s*[:.-]?\s*)(\d{5}(?:[- ]?\d{3})?)(\s*)$/iu;
const citySuffix = /^(\s*)([\p{L}][\p{L}'’ -]*?)([\s/–-]+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\s*)$/iu;

function updatedSegment(component: Component, part: string, before: string, after: string, change: Replacement) {
  let match: RegExpMatchArray | null;
  if (component === 'Número da casa') {
    match = part.match(houseSegment);
    if (match && !match[1].trim() && !street.test(fold(before))) return;
    // Number attached to the street name: preserve the spelling and label.
    if (!match && street.test(fold(part))) {
      const labelledNumbers = [...part.matchAll(/\b(?:n[uú]mero|n(?:[º°.]|o\.)?)\s*[:.-]?\s*\d{1,6}[a-z]?\b/giu)];
      if (labelledNumbers.length === 1 && street.test(fold(part.slice(0, labelledNumbers[0].index)))) {
        match = part.match(/^(.+?\s+(?:n[uú]mero|n(?:[º°.]|o\.)?)\s*[:.-]?\s*)(\d{1,6}[a-z]?)(\b.*)$/iu);
      }
      if (!match && !labelledNumbers.length && !/\b(?:km|br|rodovia|quadra|lote|bloco|apto|apartamento|casa|cep)\b/u.test(fold(part))) {
        const suffix = part.match(/^(.+?\s+)(\d{1,6}[a-z]?)(\s*)$/iu);
        // "Rua 88" or "Rua Principal 88, 114" names the street; don't edit it.
        if (suffix && street.test(fold(suffix[1])) && !houseSegment.test(after)) match = suffix;
      }
    }
  } else if (component === 'Logradouro') {
    if (!street.test(fold(part)) || !street.test(fold(change.value)) || change.value.includes(',')) return;
    // Street names may themselves contain numbers. Only detach the number when labelled.
    const withNumber = part.match(/^(\s*)(.+?)(\s+(?:n[uú]mero|n[º°.])\s*[:.-]?\s*\d{1,6}[a-z]?\s*)$/iu);
    if (!withNumber && /\s+\d+[a-z]?\s*$/iu.test(part) && !houseSegment.test(after)) return;
    match = withNumber ?? part.match(/^(\s*)(.+?)(\s*)$/u);
  } else if (component === 'CEP') {
    match = part.match(postalSegment);
  } else {
    // Preserve the state suffix even if the app rendered the city without a label.
    const label = component === 'Bairro' ? /^(\s*bairro\s*[:.-]?\s+)(.+?)(\s*)$/iu
      : /^(\s*(?:cidade|munic[ií]pio)\s*[:.-]?\s+)(.+?)(\s*)$/iu;
    match = part.match(label);
    const city = (match?.[2] || part).match(citySuffix);
    if (component === 'Cidade' && city) {
      match = [part, (match?.[1] ?? '') + city[1], city[2], city[3]];
    } else if (component === 'Bairro' && !match && after.trim().match(citySuffix) && (before.match(houseSegment) || change.old)) {
      match = part.match(/^(\s*)([\p{L}][\p{L}\p{N}'’ -]*?)(\s*)$/u);
    }
  }
  if (!match) return;
  const normalize = component === 'CEP' ? (text: string) => text.replace(/\D/g, '') : fold;
  if (change.old && normalize(change.old) !== normalize(match[2])) return;
  const value = component === 'CEP' ? formatContractAddress('CEP ' + change.value).slice(4) : change.value;
  return match[1] + value + match[3];
}

/** An address from a displayed review plus one client message. An ambiguous
 * correction invalidates that review (null); unrelated messages have no effect. */
export function applyAddressCorrection(address: string, message: string): string | null | undefined {
  const wording = fold(message);
  if (/\b(?:representante|procurador|escritorio|advogado|testemunha)\b/u.test(wording)) return;
  const signalsCorrection = /\b(?:errad[oa]|incorret[oa]|corrig\w*|corrij\w*|troqu\w*|trocar|mude|alter\w*|nao e|e nao|em vez de)\b/u.test(wording);
  const fields = componentsOf(message);
  if (!fields.length) {
    // A number-only contrast can refer to a phone, a fee or any other field on the
    // ficha. The caller supplies the label only for a reply to a targeted question.
    return signalsCorrection && /\b(?:endereco|logradouro|rua|estrada|km|apartamento|apto|complemento|quadra|lote|bloco)\b/u.test(wording) ? null : undefined;
  }
  const direct = /(?:n[uú]mero(?: d[ao] \w+)?|bairro|cep|cidade|munic[ií]pio|logradouro|rua|avenida|estrada|rodovia|travessa)\s*(?::|(?:corret[oa] )?[eé]\s)/iu.test(message);
  if (!signalsCorrection && !direct) return;
  if (fields.length !== 1 || /[?？]|\b(?:talvez|acho|se for|nao sei|ou|nao tenho certeza|nao (?:troque|altere|corrija|mude)|nao (?:quero|e para) (?:trocar|alterar|corrigir|mudar))\b/u.test(wording)) return null;

  const component = fields[0];
  const change = replacement(component, message);
  if (!change) return null;
  const parts = address.split(/([,;\n])/u);
  const changed = parts.flatMap((part, i) => {
    if (i % 2) return [];
    const updated = updatedSegment(component, part, parts[i - 2] ?? '', parts[i + 2] ?? '', change);
    return updated === undefined ? [] : [{ index: i, updated }];
  });
  if (!changed.length && address.trim() && !change.old) {
    if (component === 'CEP' && !/\bcep\b/iu.test(address)) {
      if (/\b\d{5}-\d{3}\b/u.test(address)) return null;
      return address.trimEnd() + ', ' + formatContractAddress('CEP ' + change.value);
    }
    const segments = parts.filter((_, i) => i % 2 === 0);
    const streetOnly = street.test(fold(segments[0])) && (segments.length === 1 ||
      (segments.length === 2 && houseSegment.test(segments[1])));
    if (component === 'Bairro' && streetOnly) return address.trimEnd() + ', Bairro ' + change.value;
  }
  if (changed.length !== 1) return null;
  parts[changed[0].index] = changed[0].updated;
  return parts.join('');
}
