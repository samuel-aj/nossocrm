import { normalizeKeyword } from './text';
import type { Outcome } from './types';

export type RequiredField = NonNullable<Outcome['required_data']>[number];
const absent = /^(?:[-–—]+|n\/?[ad]|nao(?: informad[oa]| sei| tenho| possuo| se aplica| consta)?|sem informacao|pendente|ausente|ignorado|desconhecid[oa]|null|undefined|a confirmar)$/;
const states: Record<string, string> = {
  acre: 'ac', alagoas: 'al', amapa: 'ap', amazonas: 'am', bahia: 'ba', ceara: 'ce', 'distrito federal': 'df',
  'espirito santo': 'es', goias: 'go', maranhao: 'ma', 'mato grosso do sul': 'ms', 'mato grosso': 'mt',
  'minas gerais': 'mg', paraiba: 'pb', parana: 'pr', para: 'pa', pernambuco: 'pe', piaui: 'pi',
  'rio de janeiro': 'rj', 'rio grande do norte': 'rn', 'rio grande do sul': 'rs', rondonia: 'ro',
  roraima: 'rr', 'santa catarina': 'sc', 'sao paulo': 'sp', sergipe: 'se', tocantins: 'to',
};
const stateNames = new RegExp('\\b(?:' + Object.keys(states).join('|') + ')\\b', 'g');
const stateCodes = new Set(Object.values(states));
const issuingBodies = /\b(?:ssp|sds|sesp|sesed|segup|sspds|sejusp|sjtc|iifp|ifp|iicce|iirgd|iimg|iipr|iirs|ii|pc|pcivil|detran|pf|dpf|dpc|dpma|me|md|mb|fab|eb|pm|cbm|cnm|mte|oab|conselho|instituto|policia|secretaria|marinha|exercito|aeronautica|bombeiros|ministerio)\b/;

function issuerTokens(text: string) {
  return normalizeKeyword(text).replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ')
    .replace(stateNames, name => states[name]).replace(/secretaria (?:de |da )?seguranca publica/g, 'ssp')
    .replace(/\b(?:de|da|do)\b/g, '').replace(/\s+/g, ' ').trim();
}

function isIssuer(text: string) {
  const tokens = issuerTokens(text).split(' ');
  const uf = tokens.pop();
  // Keep an unfamiliar acronym eligible when the lead explicitly identifies its role.
  const explicitAgency = /^(?:orgao (?:expedidor|emissor)|emitido (?:por|pelo))\s*:?\s*[a-z]{2,9}\b/i;
  const identified = explicitAgency.test(normalizeKeyword(text));
  return !!uf && stateCodes.has(uf) && (issuingBodies.test(tokens.join(' ')) || identified);
}

export function issuerMentioned(value: unknown, messages: string[]) {
  if (typeof value !== 'string' || !isIssuer(value)) return false;
  const needle = ' ' + issuerTokens(value) + ' ';
  return messages.some(message => (' ' + issuerTokens(message) + ' ').includes(needle));
}

function validCpf(value: string) {
  const digits = value.replace(/[.\s-]/g, '');
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  return [9, 10].every(length => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    return (sum * 10 % 11) % 10 === Number(digits[length]);
  });
}

export function validOutcomeField(field: RequiredField, value: unknown) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || absent.test(normalizeKeyword(text)) || /[[\]\u202a-\u202e\u2066-\u2069]/u.test(text)) return false;
  switch (field.format) {
    case 'br_document_issuer': return isIssuer(text);
    case 'br_identity': return /\d/.test(text);
    case 'br_cpf': return validCpf(text);
    case 'br_state': return stateCodes.has(text.toLowerCase());
    case 'br_postcode': return /^\d{8}$/.test(text.replace(/[.\s-]/g, ''));
    case 'phone': return /^(?:\d{10,11}|55\d{10,11}|\+[1-9]\d{7,14})$/.test(text.replace(/[\s().-]/g, ''));
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text);
    default: return true;
  }
}
