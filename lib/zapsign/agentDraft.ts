import { createHash } from 'node:crypto';
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

// Every fragment of the address has to be in the client's own words, in the order the
// fragments are listed. One message (a long audio) can carry several of them. A bare house
// number must be the whole answer or explicitly identified (a substring of a CPF is not evidence).
const HOUSE_NUMBER = [' numero ', ' numero e ', ' numero da casa e ', ' numero da rua e ', ' n ', ' nº '];
function addressInParts(candidate: string, turns: ContractTurn[]) {
  const segments = candidate.split(/[,;\n]+/).map(norm);
  if (segments.length < 2 || segments.length > 12 || segments.some(s => !s)) return false;
  const words = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const messages = turns.filter(t => t.ok && t.direction === 'in').map(t => words(t.text));
  let next = 0;
  for (const message of messages) {
    const bounded = ' ' + message + ' ';
    for (let found = true; found && next < segments.length;) {
      found = false;
      for (let end = segments.length; end > next; end--) {
        const fragment = words(segments.slice(next,end).join(' '));
        const match = /^\d+$/.test(fragment)
          ? HOUSE_NUMBER.some(prefix => bounded.includes(prefix + fragment + ' '))
          : fragment.length >= 3 && bounded.includes(' ' + fragment + ' ');
        if (fragment && (message === fragment || match)) {
          next = end;
          found = true;
          break;
        }
      }
    }
    if (next === segments.length) return true;
  }
  return false;
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
  const evidenced = (s: string) => input.turns.some(t => t.direction === 'in' && t.ok && norm(t.text).includes(norm(s)));
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
  const proposedName = plain(input.supplied.nome_signatario || suppliedIdentity.name || accepted?.name || '');
  const proposedPhone = plain(input.supplied.telefone_signatario || suppliedIdentity.phone || accepted?.phone || '');
  if (proposedName && norm(proposedName) !== norm(identity.name)) {
    identity.name = evidenced(proposedName) || norm(accepted?.name ?? '') === norm(proposedName) ? proposedName : '';
  }
  if (proposedPhone && signerPhone(proposedPhone) !== signerPhone(identity.phone)) {
    const number = signerPhone(proposedPhone);
    const attested = input.turns.some(t => t.ok && t.direction === 'in' && containsPhone(t.text, number));
    identity.phone = attested || number === accepted?.phone ? number : '';
  }
  identity.phone = signerPhone(identity.phone);
  identity.email = customerEmail(input.turns, input.supplied.email_signatario || suppliedIdentity.email || '', accepted?.email ?? identity.email);
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
    if (!value) {
      const candidate = Object.hasOwn(input.supplied, name) ? plain(input.supplied[name]) : '';
      const fromClient = (personal.test(normalizeVarName(name)) || (source === 'cliente:perguntar' && canCollectContractField(name))) &&
        !source.startsWith('texto:') && !source.startsWith('negocio.') &&
        !(source.startsWith('campo:') && input.ctx.customFieldTypes?.[source.slice(6)] === 'currency');
      const confirmed = accepted?.fields.get(normalizeVarName(name));
      if (fromClient && confirmed && (!candidate || norm(candidate) === norm(confirmed))) value = confirmed;
      else if (fromClient && candidate && (evidenced(candidate) ||
        (/^(endereco|logradouro)/.test(normalizeVarName(name)) && addressInParts(candidate, input.turns)))) value = candidate;
      else (fromClient ? missing : office).push(name);
    }
    data.push({ de: '{{' + name + '}}', para: value });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([input.scope, input.template.revision, identity, data])).digest('hex');
  const lines = data.flatMap(({ de, para }) => {
    const label = de.slice(2, -2);
    return para.trim() && !signerField(label, sources[label]) ? [label + ': ' + para] : [];
  });
  const summary = ['Nome: ' + signer, 'Telefone: ' + identity.phone, 'E-mail: ' + (identity.email || 'não informado'), ...lines].join(' · ');
  const question = summary + '\n\n' + reviewQuestion;
  return { data, missing, office, question, signer, identity, fingerprint };
}

type Draft = ReturnType<typeof prepareAgentDraft>;

function reviewKey(draft: Draft, inboundId: string, short: boolean) {
  return createHash('sha256').update(JSON.stringify([draft.fingerprint, inboundId, short])).digest('hex');
}

const fold = (s: string) => norm(s).normalize('NFD').replace(/\p{M}/gu, '');

// An acceptance is a sequence of these whole phrases and nothing else. Single words are
// not enough: "o que é isso" and "os dados corretos eu já enviei" are not acceptances.
const YES = new RegExp('^(?:' + [
  'sim', 'ok(?:ay|ey)?', 'confirmo', 'confirmei', '(?:(?:esta|ta) )?confirmad[oa]s?',
  '(?:(?:esta|ta|estao|tao) )?(?:(?:tudo|td) )?(?:cert[oa]s?|certinh[oa]s?|corret[oa]s?|perfeito|beleza)',
  '(?:esta|ta|tudo|td)(?: tudo)? (?:bom|bem|otimo|joia)',
  '(?:(?:todos )?os )?dados (?:(?:estao|tao) )?(?:certos|corretos)', 'a ficha (?:esta|ta) (?:certa|correta)',
  '(?:e )?isso(?: ai)?(?: mesmo)?', 'exato', 'exatamente', 'positivo', 'claro', 'com certeza', 'sem duvidas?', 'de acordo',
  'nao (?:tem|tenho|ha) duvidas?(?: (?:nao|nenhuma))?', 'concordo', 'aceito', 'autorizo', 'autorizado', 'fechado', 'combinado', 'blz', 'aham', 'uhum',
  'pode(?: sim)?(?: ser)?(?: (?:criar|gerar|preparar|enviar|mandar|fazer|seguir|prosseguir|continuar))?(?: o (?:contrato|documento|link))?',
].join('|') + ')(?= |$)');
const POLITE = /^(?:obrigad[oa]|obg|valeu|vlw|por favor|bo(?:m|a) (?:dia|tarde|noite)|senhora?|doutora?|dra?|moc[ao]|ta|e)(?= |$)/;

/** 'yes' accepts, 'neutral' adds nothing ("obrigado"), 'no' is anything else: a number, a correction, a doubt. */
function acceptance(text: string): 'yes' | 'neutral' | 'no' {
  if (!text.trim() || text.includes('?')) return 'no';
  let rest = fold(text).replace(/[\u{1F44D}\u{1F44C}\u{2705}\u{1F91D}]/gu, ' ok ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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

/** The agent may close with a short nudge ("é só responder sim"), never with new data or another subject. */
function asked(text: string, question: string) {
  const at = text.lastIndexOf(question);
  if (at < 0) return false;
  const tail = text.slice(at + question.length).trim();
  return !tail || (tail.length <= 300 && !/[\d:@]/.test(tail) &&
    (!tail.includes('?') || /\b(?:sim|ok|confirm\p{L}*|contrato|ficha|dados)(?![\p{L}\p{N}])/u.test(tail)));
}

function askedShort(text: string) {
  const question = norm(shortQuestion);
  const head = text.slice(0, Math.max(text.lastIndexOf(question), 0)).trim();
  return asked(text, question) && head.length <= 300 && !/[\d:@]/.test(head);
}

function questionIntent(text: string) {
  const finalQuestion = text.split(/[.!?\n]/).map(norm).filter(Boolean).at(-1) ?? '';
  const coreQuestion = finalQuestion.replace(/ e (?:te )?(?:enviar|mandar) o link(?: por aqui)?$/, '');
  const asksForContract = /^(?:com (?:esses|estes) dados,? )?posso (?:gerar|criar|preparar|enviar) o contrato$/.test(coreQuestion) ||
    /^(?:você )?confirma (?:os dados(?: da ficha)?|a ficha) para (?:eu |a gente )?(?:gerar|criar|preparar) o contrato$/.test(coreQuestion);
  const confirmsFicha = /^(?:(?:você )?(?:confirma|confere)(?: (?:os dados(?: da ficha)?|a ficha))?|(?:os dados |os dados da ficha )?estão (?:todos )?(?:certos|corretos)|(?:está |tá )?tudo (?:certo|correto))$/.test(finalQuestion);
  return { asksForContract, confirmsFicha };
}

/** Only an affirmative reply to the actual ficha can attest data read from an attachment. */
function acceptedFicha(turns: ContractTurn[]) {
  const now = Date.now();
  let answer = answeredQuestion(turns, now);
  if (answer && askedShort(answer.text)) {
    const index = turns.findIndex(t => t.id === answer?.inboundId);
    answer = answeredQuestion(turns.slice(0, index + 1), now);
  }
  if (!answer || !answer.text.endsWith('?') || !/\b(?:ficha|dados)\b/.test(answer.text)) return;
  const { asksForContract, confirmsFicha } = questionIntent(answer.raw);
  if (!asksForContract && !confirmsFicha) return;
  // WhatsApp bold ("*CPF:* 123") is not part of the label or the value.
  const raw = answer.raw.replaceAll('*', '');
  const name = raw.match(/(?:^|[\n·;])\s*Nome(?: completo)?\s*:\s*([^·;\n]+)/iu)?.[1]?.trim();
  const phone = raw.match(/\b(?:Telefone(?: com DDD)?|Celular)\s*:\s*([+()\d][\d ()-]+)/iu)?.[1];
  const email = raw.match(/\bE-?mail\s*:\s*([^·;\n\s]+(?: informado)?)/iu)?.[1];
  const fields = new Map<string, string | null>();
  // A sentence ends a field only when a plain label follows. "Av. Brasil, 120 · CPF: …"
  // is one address: what comes after "Av." has a comma or a separator before the next colon.
  for (const line of raw.split(/[\n·;]|\.\s+(?=(?:[\p{L}][^.:!?\n·;,]{0,65}:|(?:você )?(?:confirma|confere|posso|estão|está)\b))/iu)) {
    const match = line.trim().match(/^(?:[-*•]\s*)?([^:!?]{1,100}):\s*([^:!?]+)$/u);
    if (!match) continue;
    const key = normalizeVarName(match[1]);
    const value = plain(match[2]);
    fields.set(key, fields.has(key) && fields.get(key) !== value ? null : value);
  }
  return { fields, name: name && fullSignerName(name) ? name : undefined, phone: phone ? signerPhone(phone) : undefined,
    email: email ? signerEmail(email.replace(/[.,!?]+$/u, '')) : undefined };
}

export function contractReview(turns: ContractTurn[], draft: Draft, savedKey?: string, now = Date.now()) {
  const answer = answeredQuestion(turns, now);
  const reviewedFields = !!answer && /\b(?:ficha|dados)\b/.test(answer.text) && containsPhone(answer.text, draft.identity.phone) &&
    [draft.signer, draft.identity.email, ...draft.data.map(d => d.para.trim()).filter(v => v !== draft.identity.phone)]
      .filter(Boolean).every(value => answer.text.includes(norm(value)));
  const { asksForContract, confirmsFicha } = questionIntent(answer?.raw ?? '');
  const useShort = reviewedFields && (asksForContract || confirmsFicha) && answer.text.endsWith('?');
  const confirmsFull = !!answer && savedKey === reviewKey(draft, answer.inboundId, false) &&
    (asked(answer.text, norm(draft.question)) || (reviewedFields && asksForContract && answer.text.endsWith('?')));
  const confirmsShort = !!answer && savedKey === reviewKey(draft, answer.inboundId, true) && askedShort(answer.text);
  const confirmed = !!answer && (confirmsFull || confirmsShort);
  // A ficha sent before the contract tool was called can already contain the full summary.
  // In that case only ask for issuance, without asking for the data again.
  const current = turns.at(-1);
  const question = useShort ? shortQuestion : draft.question;
  return { confirmed, question, repeated: timesAsked(turns, question, now),
    key: current?.direction === 'in' ? reviewKey(draft, current.id, useShort) : undefined };
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
