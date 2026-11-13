import { createHash } from 'node:crypto';
import { addressCorrectionComponent, applyAddressCorrection } from './addressCorrection';
import { addressHasCustomerEvidence, contractPersonalField, contractPersonalValueKey, cpfHasCustomerEvidence, formatContractAddress,
  formatContractCpf, sameContractPersonalValue, type ContractPersonalField } from './contractPersonalFields';
import { fullSignerName, signerEmail, signerField, signerPhone, type SignerIdentity } from './signerIdentity';
import { autoMatchVariable, canCollectContractField, normalizeVarName, resolveSource, type VariableContext } from './variables';

export type ContractTurn = { id: string; direction: 'in' | 'out'; text: string; agent: boolean; ok: boolean; at: string };
export type ContractFields = Record<string, string>;
export type AgentContractInput = { modo: 'preparar' | 'criar'; dados: ContractFields };
const plain = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => plain(s).toLocaleLowerCase('pt-BR');
// Only identification data can come from client messages. Prices, products,
// deadlines and any other office-defined terms must have a source in the CRM.
const personal = /^(?:(?:nome(?:completo)?|cpf|cnpj|rg|email|telefone|celular|whatsapp|endereco|logradouro|bairro|cep|numero|complemento|cidade|estado|uf|nacionalidade|estadocivil|profissao|datanascimento|datadenascimento)(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante))?)$/;
/** After this many copies of the same ficha without an acceptance, a person takes over. */
export const MAX_REVIEW_REQUESTS = 3;
export const REVIEW_HINT = 'Envie solicitar_confirmacao uma única vez e termine a resposta nela. Não peça para o cliente copiar ou repetir o texto: basta ele responder sim, ok, confirmado ou tá certo. Se ele corrigir um dado, prepare de novo.';
const reviewQuestion = 'Você confirma os dados da ficha para eu gerar o contrato e enviar o link por aqui?';
const shortQuestion = 'Posso gerar o contrato com os dados que você confirmou e enviar o link por aqui?';

/** Resolve a field on the accepted ficha even when the template uses a different
 * client-facing label. Conflicting values must be collected again. */
function reviewedPersonalField(fields: ReadonlyMap<string, string | null> | undefined, kind: ContractPersonalField) {
  let value: string | undefined;
  if (!fields) return;
  for (const [key, entry] of fields) {
    if (contractPersonalField(key) !== kind) continue;
    if (!entry || (value && !sameContractPersonalValue(kind, value, entry))) return null;
    value ??= entry;
  }
  return value;
}

function personalValue(kind: ContractPersonalField, candidate: string, reviewed: string | null | undefined,
  saved: string, messages: readonly string[]) {
  if (reviewed === null) return '';
  let value = saved;
  if (reviewed) {
    if (candidate && !sameContractPersonalValue(kind, candidate, reviewed)) return '';
    value = reviewed;
  } else if (candidate) {
    const matchesSaved = !!saved && sameContractPersonalValue(kind, candidate, saved);
    const attested = kind === 'cpf' ? cpfHasCustomerEvidence(candidate, messages) : addressHasCustomerEvidence(candidate, messages);
    if (!matchesSaved && !attested) return '';
    value = candidate;
  }
  return kind === 'cpf' ? formatContractCpf(value) || '' : formatContractAddress(value);
}

function containsPhone(text: string, number: string) {
  return !!number && (text.match(/\+?\d[\d\s().-]{6,}\d/g) ?? []).some(part => signerPhone(part) === number);
}

function customerEmail(turns: ContractTurn[], supplied: string, registered: string) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn.ok || turn.direction !== 'in') continue;
    const message = plain(turn.text);
    if (/^(?:n[aã]o(?: tenho| possuo)?|prefiro n[aã]o informar)[.!]?$/iu.test(message) &&
        turns[i - 1]?.direction === 'out' && /e[\s-]?mail[^?]*\?\s*$/iu.test(turns[i - 1].text)) return '';
    if (/\b(?:n[aã]o (?:tenho|possuo|uso)(?: (?:um|nenhum))? e[\s-]?mail|prefiro (?:continuar sem informar|n[aã]o informar)(?: (?:o |meu )?e[\s-]?mail)?|sem e[\s-]?mail)\b/iu.test(message)) return '';
    const addresses = message.match(/[\p{L}\d.!#$%&'*+/=?^_\x60{|}~-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu) ?? [];
    if (supplied && addresses.some(email => norm(email) === norm(supplied))) return signerEmail(supplied);
    // Recover a directly stated personal address if the tool omits it on a later turn.
    if (addresses.length === 1 && (message === addresses[0] || /^meu e-?mail (?:é|eh) /iu.test(message))) return signerEmail(addresses[0]);
  }
  return supplied.trim() && !signerEmail(supplied) ? '' : signerEmail(registered);
}

export function prepareAgentDraft(input: {
  scope: string[]; template: { name: string; revision: string; names: string[] };
  signer: string; ctx: VariableContext; fields: { key: string; label: string }[];
  turns: ContractTurn[]; supplied: ContractFields; mapping?: ContractFields;
}) {
  const data: { de: string; para: string }[] = [];
  const missing: string[] = [], office: string[] = [];
  const customerMessages = input.turns.filter(t => t.direction === 'in' && t.ok).map(t => t.text);
  const evidenced = (s: string) => customerMessages.some(text => norm(text).includes(norm(s)));
  const sources = Object.fromEntries(input.template.names.map(name => [name,
    input.mapping?.[name] ?? autoMatchVariable(name, input.fields)]));
  const identity: SignerIdentity = { name: plain(input.signer), phone: input.ctx.contact.phone, email: input.ctx.contact.email };
  const suppliedIdentity: Partial<SignerIdentity> = {};
  for (const [label, source] of Object.entries(sources)) {
    const field = signerField(label, source);
    if (!field) continue;
    const saved = plain(resolveSource(source, input.ctx));
    if (saved) identity[field] = saved;
    if (input.supplied[label]?.trim()) suppliedIdentity[field] = plain(input.supplied[label]);
  }
  // A model may omit the signer inputs on the second call. Recover the exact
  // identity displayed in our review. Issuance still requires its stored hash.
  const accepted = acceptedFicha(input.turns);
  const revision = pendingAddressRevision(input.turns);
  // A corrected review is a draft. Confirmation is still checked against the
  // data and the message actually sent, by contractReview below.
  const previous = accepted ?? revision?.ficha;
  const proposedName = plain(input.supplied.nome_signatario || suppliedIdentity.name || previous?.name || '');
  const proposedPhone = plain(input.supplied.telefone_signatario || suppliedIdentity.phone || previous?.phone || '');
  if (proposedName && norm(proposedName) !== norm(identity.name)) {
    identity.name = evidenced(proposedName) || norm(previous?.name ?? '') === norm(proposedName) ? proposedName : '';
  }
  if (proposedPhone && signerPhone(proposedPhone) !== signerPhone(identity.phone)) {
    const number = signerPhone(proposedPhone);
    const attested = input.turns.some(t => t.ok && t.direction === 'in' && containsPhone(t.text, number));
    identity.phone = attested || number === previous?.phone ? number : '';
  }
  identity.phone = signerPhone(identity.phone);
  identity.email = customerEmail(input.turns, input.supplied.email_signatario || suppliedIdentity.email || '', previous?.email ?? identity.email);
  const signer = identity.name;
  if (!fullSignerName(signer)) missing.push('Nome completo de quem vai assinar');
  if (!identity.phone) missing.push('Telefone com DDD de quem vai assinar');
  for (const name of input.template.names) {
    const source = sources[name];
    const identityField = signerField(name, source);
    if (identityField) {
      data.push({ de: '{{' + name + '}}', para: identity[identityField] || (identityField === 'email' ? ' ' : '') });
      continue;
    }
    let value = plain(resolveSource(source, input.ctx));
    if (/^negocio\.valor/.test(source) && !(Number(input.ctx.deal.value) > 0)) value = '';
    const key = normalizeVarName(name);
    const kind = contractPersonalField(name);
    const customField = source.startsWith('campo:') && input.ctx.customFieldTypes?.[source.slice(6)] !== 'currency';
    const fromClient = (!source || source === 'cliente:perguntar' || customField) &&
      (kind !== undefined || personal.test(key) || (source === 'cliente:perguntar' && canCollectContractField(name)));
    const candidate = Object.hasOwn(input.supplied, name) ? plain(input.supplied[name]) : '';
    if (kind === 'address' && fromClient && revision) {
      value = revision.address ?? '';
    } else if (kind && fromClient) {
      value = personalValue(kind, candidate, reviewedPersonalField(previous?.fields, kind), value, customerMessages);
    } else if (!value && fromClient) {
      const confirmed = previous?.fields.get(key);
      if (confirmed && (!candidate || norm(candidate) === norm(confirmed))) value = confirmed;
      else if (candidate && (evidenced(candidate) || (key.startsWith('logradouro') && addressHasCustomerEvidence(candidate, customerMessages)))) value = candidate;
    }
    if (!value) (fromClient ? missing : office).push((fromClient && kind === 'address' && revision?.component) || name);
    data.push({ de: '{{' + name + '}}', para: value });
  }
  const reviewData = data.map(field => {
    const kind = contractPersonalField(field.de.slice(2, -2));
    return kind ? { ...field, para: contractPersonalValueKey(kind, field.para) ?? field.para } : field;
  });
  const hashData = (values: typeof data) =>
    createHash('sha256').update(JSON.stringify([input.scope, input.template.revision, identity, values])).digest('hex');
  const fingerprint = hashData(reviewData);
  // A review already shown before personal-field normalization used the exact document text.
  const previousFingerprint = hashData(data);
  const lines = data.flatMap(({ de, para }) => {
    const label = de.slice(2, -2);
    return para.trim() && !signerField(label, sources[label]) ? [label + ': ' + para] : [];
  });
  const summary = ['Nome: ' + signer, 'Telefone: ' + identity.phone, 'E-mail: ' + (identity.email || 'não informado'), ...lines].join(' · ');
  const question = summary + '\n\n' + reviewQuestion;
  return { data, missing, office, question, signer, identity, fingerprint, previousFingerprint };
}

type Draft = ReturnType<typeof prepareAgentDraft>;

function reviewKey(fingerprint: string, inboundId: string, short: boolean) {
  return createHash('sha256').update(JSON.stringify([fingerprint, inboundId, short])).digest('hex');
}

const fold = (s: string) => norm(s).normalize('NFD').replace(/\p{M}/gu, '');

// An acceptance is a sequence of these whole phrases and nothing else. Single words are
// not enough: "o que é isso" and "os dados corretos eu já enviei" are not acceptances.
const YES = new RegExp('^(?:' + [
  '(?:eu )?(?:confirmo|autorizo)(?: (?:a ficha|(?:todos )?(?:(?:os )?meus |os )dados|a (?:emissao|criacao) do contrato))?',
  '(?:os |meus |os meus |esses |estes )?dados (?:conferem|(?:estao|tao) (?:todos )?(?:certos|corretos|certinhos))',
  '(?:(?:a |minha )?ficha |(?:tudo|os dados) )?confere(?:m)?(?: (?:tudo|com (?:os )?meus dados|com a ficha))?',
  '(?:os |meus |os meus )dados batem', '(?:concordo|estou de acordo) com (?:os dados|a ficha)',
  'sao esses (?:mesmo|os meus dados)', '(?:esses|estes) sao (?:os )?meus dados', '(?:esta|estou) de acordo', '(?:e )?assim mesmo',
  'sem problemas?', 'pode (?:sim )?(?:dar (?:andamento|continuidade)|emitir|fazer)(?: (?:ao |o )?contrato)?',
  'sim', 'ok(?:ay|ey)?', 'confirmo', 'confirmei', '(?:(?:esta|ta) )?confirmad[oa]s?',
  '(?:(?:esta|ta|estao|tao) )?(?:(?:tudo|td) )?(?:cert[oa]s?|certinh[oa]s?|corret[oa]s?|perfeito|beleza)',
  '(?:esta|ta|tudo|td)(?: tudo)? (?:bom|bem|otimo|joia)',
  '(?:(?:todos )?os )?dados (?:(?:estao|tao) )?(?:certos|corretos)', 'a ficha (?:esta|ta) (?:certa|correta)',
  '(?:e )?isso(?: ai)?(?: mesmo)?', 'exato', 'exatamente', 'positivo', 'claro', 'com certeza', 'sem duvidas?', 'de acordo',
  'concordo', 'aceito', 'autorizo', 'autorizado', 'fechado', 'combinado', 'blz', 'aham', 'uhum',
  'pode(?: sim)?(?: ser)?(?: (?:criar|gerar|preparar|enviar|mandar|fazer|seguir|prosseguir|continuar))?(?: o (?:contrato|documento|link))?',
].join('|') + ')(?= |$)');
const POLITE = /^(?:(?:para|pra) mim|(?:eu )?(?:ja )?(?:conferi|revisei)(?: (?:tudo|a ficha|(?:todos )?os (?:meus )?dados))?|nao (?:tem|tenho|ha) duvidas?(?: (?:nao|nenhuma))?|obrigad[oa]|obg|valeu|vlw|por favor|bo(?:m|a) (?:dia|tarde|noite)|senhora?|doutora?|dra?|moc[ao]|ta|e)(?= |$)/;

/** 'yes' accepts, 'neutral' adds nothing ("obrigado"), 'no' is anything else: a number, a correction, a doubt. */
function acceptance(text: string): 'yes' | 'neutral' | 'no' {
  if (!text.trim() || /[?？]/u.test(text)) return 'no';
  // Drop punctuation after recognizing approval emoji. An unrecognized symbol,
  // e.g. a thumbs-down after "sim", may change the meaning of the answer.
  let rest = fold(text)
    .replace(/(?:\u{1F44D}|\u{1F44C}|\u{2705}|\u{1F91D})(?:[\uFE0F\u{1F3FB}-\u{1F3FF}])*/gu, ' ok ')
    .replace(/[\s.,!'"“”‘’…;:-]+/gu, ' ').trim();
  let accepted = false;
  while (rest) {
    const yes = YES.exec(rest), phrase = yes ?? POLITE.exec(rest);
    if (!phrase) return 'no';
    accepted ||= !!yes;
    rest = rest.slice(phrase[0].length).trim();
  }
  return accepted ? 'yes' : 'neutral';
}

function answeredQuestion(turns: ContractTurn[], now: number) {
  const reply = turns.at(-1);
  // The client often answers in more than one message ("Confirmado ok", "Tudo certo").
  // Every message after the agent's question has to be part of the acceptance.
  let i = turns.length - 1, accepted = false;
  for (; i >= 0 && turns[i].direction === 'in'; i--) {
    const kind = turns[i].ok ? acceptance(turns[i].text) : 'no';
    if (kind === 'no') return;
    accepted ||= kind === 'yes';
  }
  if (!reply || !accepted) return;
  const previous: string[] = [];
  for (; i >= 0; i--) {
    const t = turns[i];
    if (t.direction === 'in') {
      const raw = previous.join('\n').trim();
      return { text: norm(raw), raw, inboundId: t.id };
    }
    if (!t.ok || !t.agent || !Number.isFinite(Date.parse(t.at)) ||
        now - Date.parse(t.at) > 86_400_000 || Date.parse(t.at) > Date.parse(reply.at)) return;
    previous.unshift(t.text);
  }
}

// A reminder can follow the question, but an unrelated question or changed
// terms must never turn its answer into approval of the preceding ficha.
function isResponseHint(sentence: string) {
  const text = fold(sentence).replace(/["“”'‘’*]/g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:e so |basta |voce pode |pode )(?:responder|mandar|enviar|dizer)|(?:responda|mande|diga)) (?:(?:com )?(?:um )?(?:sim|ok|confirmado)(?: (?:ou|e) (?:sim|ok|confirmado))?)(?: (?:aqui|por aqui))?(?: (?:pra|para) (?:eu )?(?:gerar|criar|enviar) o contrato)?$/.test(text) ||
    /^(?:se preferir )?(?:voce )?pode (?:tambem )?(?:responder|confirmar) (?:por|em) (?:audio|texto)$/.test(text);
}

function asked(text: string, question: string) {
  const at = text.lastIndexOf(question);
  if (at < 0) return false;
  const tail = text.slice(at + question.length).trim();
  return !tail || (tail.length <= 300 && tail.split(/[.!?\n]/).map(plain).filter(Boolean).every(isResponseHint));
}

function askedShort(text: string) {
  const question = norm(shortQuestion);
  const head = text.slice(0, Math.max(text.lastIndexOf(question), 0)).trim();
  const preamble = fold(head).replace(/[.,!:*]/g, '').trim();
  return asked(text, question) && (!preamble || /^(?:perfeito|otimo|certo|obrigad[oa]|dados confirmados|ficha confirmada)$/.test(preamble));
}

function questionIntent(text: string) {
  const lines = text.trim().split(/\n+/).flatMap(line => [...line.matchAll(/([^.!?]+)([.!?]|$)/g)]);
  let i = lines.length - 1;
  while (i >= 0 && isResponseHint(lines[i][1])) i--;
  const finalQuestion = lines[i]?.[2] === '?' ? fold(lines[i][1]).replaceAll('*', '') : '';
  const coreQuestion = finalQuestion.replace(/^se (?:estiver|tiver) tudo (?:certo|correto),? /, '')
    .replace(/ e (?:te )?(?:enviar|mandar) o link(?: (?:por )?aqui)?$/, '');
  const asksForContract = /^(?:com (?:esses|estes) dados,? )?posso (?:gerar|criar|emitir|preparar|enviar|mandar) o contrato(?: com (?:esses|estes) dados| para assinatura)?$/.test(coreQuestion) ||
    /^posso (?:seguir|prosseguir) com a (?:emissao|criacao) do contrato$/.test(coreQuestion) ||
    /^(?:voce )?(?:me )?confirma (?:os dados(?: da ficha)?|a ficha) (?:para|pra) (?:eu |a gente )?(?:gerar|criar|emitir|preparar) o contrato$/.test(coreQuestion);
  const checkRequest = /^(?:voce )?(?:(?:pode|consegue) (?:me )?confirmar|(?:me )?(?:confirma|confere))(?: pra mim)?(?: |$)/;
  const asksToCheck = checkRequest.test(finalQuestion);
  const subject = asksToCheck ? finalQuestion.replace(checkRequest, '').replace(/^(?:se|que) /, '') : finalQuestion;
  const summaryLabel = /^(?:(?:os|esses|seus) dados(?: (?:da ficha|acima))?|a ficha|as informacoes(?: acima)?|tudo(?: pra mim)?)$/;
  const correctness = [
    /^(?:(?:(?:todos )?(?:os|estes|esses|seus) dados|(?:as|essas|estas) informacoes)(?: (?:da ficha|acima))? )?(?:estao|tao) (?:todos |todas )?(?:certos|certas|corretos|corretas)$/,
    /^(?:(?:a ficha |tudo )?(?:esta|ta) (?:tudo )?|tudo )(?:certa|correta|certo|correto|certinho)(?: (?:com os dados|com a ficha|assim))?$/,
    /^(?:(?:os dados |as informacoes )?conferem|os dados (?:batem|estao de acordo))$/,
  ];
  const confirmsFicha = (asksToCheck && (!subject || summaryLabel.test(subject))) || correctness.some(pattern => pattern.test(subject));
  // If both are on one line, the sentence separator is not part of the last field.
  const summary = finalQuestion ? text.slice(0, text.lastIndexOf(lines[i][0])).replace(/\.[ \t]*$/, '').trimEnd() : '';
  return { asksForContract, confirmsFicha, summary };
}

/** Only an affirmative reply to the actual ficha can attest data read from an attachment. */
function acceptedFicha(turns: ContractTurn[], now = Date.now()) {
  let answer = answeredQuestion(turns, now);
  if (answer && askedShort(answer.text)) {
    const index = turns.findIndex(t => t.id === answer?.inboundId);
    answer = answeredQuestion(turns.slice(0, index + 1), now);
  }
  if (!answer) return;
  return parseFicha(answer.raw);
}

function parseFicha(text: string) {
  const { asksForContract, confirmsFicha, summary } = questionIntent(text);
  if (!asksForContract && !confirmsFicha) return;
  // WhatsApp bold ("*CPF:* 123") is not part of the label or the value.
  const raw = summary.replaceAll('*', '');
  const fields = new Map<string, string | null>();
  // A sentence ends a field only when a plain label follows. "Av. Brasil, 120 · CPF: …"
  // is one address: what comes after "Av." has a comma or a separator before the next colon.
  for (const line of raw.split(/[\n·;]|\.\s+(?=(?:[\p{L}][^.:!?\n·;,]{0,65}:|(?:você )?(?:confirma|confere|posso|estão|está)\b))/iu)) {
    const match = line.trim().match(/^(?:(?:[-•]|\d{1,2}[)])\s*)?([^:!?]{1,100}):\s*([^:!?]+)$/u);
    if (!match) continue;
    const key = normalizeVarName(match[1]);
    const value = plain(match[2]);
    fields.set(key, fields.has(key) && fields.get(key) !== value ? null : value);
  }
  const name = fields.get('nomecompleto') ?? fields.get('nome');
  const phone = fields.get('telefonecomddd') ?? fields.get('telefone') ?? fields.get('celular');
  const email = fields.get('email');
  // A generic "tudo certo?" can attest only to an identifiable review.
  if (!/\b(?:ficha|dados)\b/i.test(text) && !(name && phone)) return;
  return { fields, name: name && fullSignerName(name) ? name : undefined, phone: phone ? signerPhone(phone) : undefined,
    email: email ? signerEmail(email.replace(/[.,!?]+$/u, '')) : undefined };
}

type PresentedFicha = NonNullable<ReturnType<typeof parseFicha>>;
type AddressRevision = {
  ficha: PresentedFicha;
  address: string | null;
  component?: ReturnType<typeof addressCorrectionComponent>;
};

// After a disputed address the customer may choose to write the whole one.
// Only use the new inbound text itself, never piece together the rejected version.
function restatedAddress(text: string) {
  const value = plain(text).replace(/^(?:(?:meu|o)\s+)?endere[çc]o(?:\s+(?:completo|correto))?\s*(?:[:：]|[eé]\s+)\s*/iu, '');
  if (value.length > 500 || /[?？]/u.test(value) ||
      /\b(?:talvez|acho|errad[oa]|em vez de|e nao|nao e|corrig\w*|representante)\b/u.test(fold(value))) return;
  if (/^(?:rua|r\.|avenida|av\.|travessa|estrada|sítio|sitio|fazenda|alameda|rodovia|praça|vila)\s/iu.test(value) &&
      value.split(/[,;]/u).filter(part => part.trim()).length >= 3) return formatContractAddress(value);
}

/** Replay the customer's edits to a displayed address. A repeated copy of the
 * old ficha or an unrelated "pode gerar" must not undo a correction. */
function pendingAddressRevision(turns: ContractTurn[], now = Date.now()): AddressRevision | undefined {
  let ficha: PresentedFicha | undefined;
  let address = '';
  let revision: AddressRevision | undefined;
  let outbound: string[] = [];
  for (const turn of turns) {
    const age = now - Date.parse(turn.at);
    if (!Number.isFinite(age) || age > 86_400_000 || !turn.ok || (turn.direction === 'out' && !turn.agent)) {
      outbound = [];
      ficha = revision = undefined;
      address = '';
      continue;
    }
    if (turn.direction === 'out') {
      outbound.push(turn.text);
      continue;
    }

    const lastQuestion = outbound.join('\n');
    outbound = [];
    const shown = lastQuestion ? parseFicha(lastQuestion) : undefined;
    if (shown) {
      const displayed = reviewedPersonalField(shown.fields, 'address');
      const differentSigner = (shown.phone && ficha?.phone && shown.phone !== ficha.phone)
        || (shown.name && ficha?.name && norm(shown.name) !== norm(ficha.name));
      if (differentSigner) revision = undefined;
      if (!revision) {
        ficha = shown;
        address = displayed || '';
      } else if (displayed && revision.address && sameContractPersonalValue('address', revision.address, displayed)) {
        // The agent showed the revised draft. Future edits start from this version.
        ficha = shown;
        address = displayed;
        revision.ficha = shown;
      }
    }
    if (!ficha || !address) continue;
    let customerText = turn.text;
    const full = revision && restatedAddress(customerText);
    if (full) {
      address = full;
      revision = { ficha, address };
      continue;
    }
    let updated = applyAddressCorrection(address, customerText);
    if (revision?.address === null && revision.component && lastQuestion.includes('?') &&
        addressCorrectionComponent(lastQuestion) === revision.component && acceptance(customerText) === 'no' &&
        updated === undefined && (!addressCorrectionComponent(customerText) || revision.component === 'Logradouro') &&
        !/[?？]/u.test(customerText) &&
        !/\b(?:cpf|rg|telefone|celular|whatsapp|documento|e-?mail|contrato|fatura|representante|advogado)\b/u.test(fold(customerText))) {
      const correction = /^(?:n[aã]o [eé]|[eé])\s/iu.test(customerText.trim()) ? ' ' : ' é ';
      customerText = revision.component + correction + customerText.trim();
      updated = applyAddressCorrection(address, customerText);
    }
    if (updated === undefined) continue;
    // Fixing a different field does not resolve one the customer still disputes.
    if (revision?.address === null && updated && addressCorrectionComponent(customerText) !== revision.component) continue;
    if (updated) address = updated;
    revision = { ficha, address: updated, component: updated === null ? addressCorrectionComponent(customerText) : undefined };
  }
  return revision;
}

export function contractReview(turns: ContractTurn[], draft: Draft, savedKey?: string, now = Date.now()) {
  const answer = answeredQuestion(turns, now);
  const ficha = acceptedFicha(turns, now);
  const reviewedFields = !!answer && (!!ficha || /\b(?:ficha|dados)\b/.test(answer.text)) &&
    containsPhone(answer.text, draft.identity.phone) && answer.text.includes(norm(draft.signer)) &&
    (!draft.identity.email || answer.text.includes(norm(draft.identity.email))) &&
    draft.data.every(({ de, para }) => {
      const value = para.trim();
      if (!value || value === draft.identity.phone) return true;
      const kind = contractPersonalField(de.slice(2, -2));
      if (kind) {
        const reviewed = reviewedPersonalField(ficha?.fields, kind);
        if (reviewed !== undefined) return reviewed !== null && sameContractPersonalValue(kind, value, reviewed);
        if (kind === 'cpf') return false;
        const address = norm(value);
        return answer.text.split(/(?:[.;·]\s+|\n)/u).some(part => part === address);
      }
      return answer.text.includes(norm(value));
    });
  const { asksForContract, confirmsFicha } = questionIntent(answer?.raw ?? '');
  const useShort = reviewedFields && (asksForContract || confirmsFicha);
  const matchesKey = (short: boolean) => !!answer && !!savedKey &&
    [draft.fingerprint, draft.previousFingerprint].some(hash => savedKey === reviewKey(hash, answer.inboundId, short));
  const confirmsFull = !!answer && matchesKey(false) &&
    (asked(answer.text, norm(draft.question)) || (reviewedFields && asksForContract));
  const confirmsShort = !!answer && matchesKey(true) && askedShort(answer.text);
  const confirmed = !!answer && (confirmsFull || confirmsShort);
  // A ficha sent before the contract tool was called can already contain the full summary.
  // In that case only ask for issuance, without asking for the data again.
  const current = turns.at(-1);
  const question = useShort ? shortQuestion : draft.question;
  return { confirmed, question, repeated: timesAsked(turns, question, now),
    key: current?.direction === 'in' ? reviewKey(draft.fingerprint, current.id, useShort) : undefined };
}

/** How many of the agent's replies in the last day already carried this exact question, so the tool can stop a loop. */
function timesAsked(turns: ContractTurn[], question: string, now: number) {
  const wanted = norm(question);
  let count = 0, block: string[] = [];
  for (const t of [...turns, undefined]) {
    if (t?.direction === 'out' && t.agent && t.ok && now - Date.parse(t.at) <= 86_400_000) { block.push(t.text); continue; }
    if (block.length && norm(block.join('\n')).includes(wanted)) count++;
    block = [];
  }
  return count;
}
