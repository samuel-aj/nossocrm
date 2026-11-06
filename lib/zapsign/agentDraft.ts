import { createHash } from 'node:crypto';
import { autoMatchVariable, canCollectContractField, normalizeVarName, resolveSource, type VariableContext } from './variables';

export type ContractTurn = { id: string; direction: 'in' | 'out'; text: string; agent: boolean; ok: boolean; at: string };
export type ContractFields = Record<string, string>;
export type AgentContractInput = { modo: 'preparar' | 'criar'; dados: ContractFields };
const plain = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => plain(s).toLocaleLowerCase('pt-BR');
// Only identification data can come from client messages. Prices, products,
// deadlines and any other office-defined terms must have a source in the CRM.
const personal = /^(?:(?:nome(?:completo)?|cpf|cnpj|rg|email|telefone|celular|whatsapp|endereco|logradouro|bairro|cep|numero|complemento|cidade|estado|uf|nacionalidade|estadocivil|profissao|datanascimento|datadenascimento)(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante))?)$/;
const customerEmail = /^email(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante|titular|contato))?$/;
const emailValue = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const reviewQuestion = 'Você confirma os dados da ficha para eu gerar o contrato e enviar o link por aqui?';
const shortQuestion = 'Posso gerar o contrato com os dados que você confirmou e enviar o link por aqui?';

function customerDocumentEmail(turns: ContractTurn[], supplied: string) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn.ok || turn.direction !== 'in') continue;
    const message = plain(turn.text);
    if (/\b(?:não (?:tenho|possuo)(?: um)? e-?mail|prefiro não informar (?:o |meu )?e-?mail|sem e-?mail)\b/iu.test(message)) break;
    const addresses = message.match(/[\p{L}\d.!#$%&'*+/=?^_\x60{|}~-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu) ?? [];
    if (supplied && emailValue.test(supplied) && addresses.some(email => norm(email) === norm(supplied))) return supplied;
    // Recover a directly stated personal address if the tool omits it on a later turn.
    if (addresses.length === 1 && (message === addresses[0] || /^meu e-?mail (?:é|eh) /iu.test(message))) return addresses[0];
  }
  return ' ';
}

export function prepareAgentDraft(input: {
  scope: string[]; template: { name: string; revision: string; names: string[] };
  signer: string; ctx: VariableContext; fields: { key: string; label: string }[];
  turns: ContractTurn[]; supplied: ContractFields; mapping?: ContractFields;
}) {
  const data: { de: string; para: string }[] = [];
  const missing: string[] = [], office: string[] = [];
  const evidenced = (s: string) => input.turns.some(t => t.direction === 'in' && t.ok && norm(t.text).includes(norm(s)));
  const providedName = plain(input.supplied.nome_signatario || '');
  const registered = plain(input.signer);
  const signer = registered.split(' ').length < 2 && providedName.split(' ').length >= 2 &&
    evidenced(providedName) ? providedName : registered;
  if (signer.split(' ').length < 2) missing.push('nome_signatario');
  for (const name of input.template.names) {
    const source = input.mapping && Object.hasOwn(input.mapping, name) ? input.mapping[name] : autoMatchVariable(name, input.fields);
    let value = plain(resolveSource(source, input.ctx));
    if (source === 'contato.nome') value = signer;
    if (/^negocio\.valor/.test(source) && !(Number(input.ctx.deal.value) > 0)) value = '';
    if (!value) {
      const candidate = Object.hasOwn(input.supplied, name) ? plain(input.supplied[name]) : '';
      const fromClient = (personal.test(normalizeVarName(name)) || (source === 'cliente:perguntar' && canCollectContractField(name))) &&
        !source.startsWith('texto:') && !source.startsWith('negocio.') &&
        !(source.startsWith('campo:') && input.ctx.customFieldTypes?.[source.slice(6)] === 'currency');
      const optionalEmail = source === 'contato.email' || (customerEmail.test(normalizeVarName(name)) && fromClient);
      if (optionalEmail) {
        // The placeholder belongs only to the document variables, never to the signer or contact.
        value = customerDocumentEmail(input.turns, candidate);
      } else if (fromClient && candidate && evidenced(candidate)) value = candidate;
      else (fromClient ? missing : office).push(name);
    }
    data.push({ de: '{{' + name + '}}', para: value });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([input.scope, input.template.revision, signer, data])).digest('hex');
  const fields = data.map(({ de, para }) => de.slice(2, -2) + ': ' + para).join('; ');
  // Continue honoring a question already delivered by the previous version.
  const legacyQuestion = 'Contrato: ' + plain(input.template.name) + '. Signatário: ' + signer +
    '. ' + (fields ? fields + '. ' : '') + 'Referência ' + fingerprint.slice(0, 12) + '. Posso criar o contrato e enviar o link por aqui?';
  const lines = data.filter(({para}) => para.trim() && para !== signer).map(({ de, para }) => de.slice(2, -2) + ': ' + para);
  const summary = ['Nome: ' + signer, ...lines].join(' · ');
  const question = summary + '\n\n' + reviewQuestion;
  return { data, missing, office, question, signer, fingerprint, legacyQuestion };
}

type Draft = ReturnType<typeof prepareAgentDraft>;

function reviewKey(draft: Draft, inboundId: string, short: boolean) {
  return createHash('sha256').update(JSON.stringify([draft.fingerprint, inboundId, short])).digest('hex');
}

function answeredQuestion(turns: ContractTurn[], now: number) {
  const reply = turns.at(-1);
  if (!reply || reply.direction !== 'in' || !reply.ok) return;
  const affirmative = norm(reply.text).replace(/[.,!]+$/g, '').replace(/^sim[, ]+/, '').trim();
  if (!/^(?:sim|confirmo|confirmado|de acordo|autorizo|isso mesmo|tudo certo|está tudo certo|estão corretos|dados corretos|a ficha está correta|pode sim|pode(?: (?:criar|gerar|preparar|enviar|mandar)(?: o (?:contrato|documento|link))?)?)$/.test(affirmative)) return;
  const previous: string[] = [];
  for (let i = turns.length - 2; i >= 0; i--) {
    const t = turns[i];
    if (t.direction === 'in' && previous.length) return { text: norm(previous.join(' ')), inboundId: t.id };
    if (t.direction !== 'out' || !t.ok || !t.agent || !Number.isFinite(Date.parse(t.at)) ||
        now - Date.parse(t.at) > 86_400_000 || Date.parse(t.at) > Date.parse(reply.at)) return;
    previous.unshift(t.text);
  }
}

export function contractReview(turns: ContractTurn[], draft: Draft, savedKey?: string, now = Date.now()) {
  const answer = answeredQuestion(turns, now);
  const reviewedFields = !!answer && /\b(?:ficha|dados)\b/.test(answer.text) &&
    [draft.signer, ...draft.data.map(d => d.para.trim()).filter(Boolean)].every(value => answer.text.includes(norm(value)));
  const finalQuestion = answer?.text.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean).at(-1) ?? '';
  const coreQuestion = finalQuestion.replace(/ e (?:te )?(?:enviar|mandar) o link(?: por aqui)?$/, '');
  const asksForContract = /^(?:com (?:esses|estes) dados,? )?posso (?:gerar|criar|preparar|enviar) o contrato$/.test(coreQuestion) ||
    /^(?:você )?confirma (?:os dados(?: da ficha)?|a ficha) para (?:eu |a gente )?(?:gerar|criar|preparar) o contrato$/.test(coreQuestion);
  const confirmsFicha = /^(?:(?:você )?(?:confirma|confere)(?: (?:os dados(?: da ficha)?|a ficha))?|(?:os dados |os dados da ficha )?estão (?:todos )?(?:certos|corretos)|(?:está |tá )?tudo (?:certo|correto))$/.test(finalQuestion);
  const useShort = reviewedFields && (asksForContract || confirmsFicha) && answer.text.endsWith('?');
  const confirmsFull = !!answer && savedKey === reviewKey(draft, answer.inboundId, false) &&
    (answer.text.endsWith(norm(draft.question)) || (reviewedFields && asksForContract && answer.text.endsWith('?')));
  const confirmsShort = !!answer && savedKey === reviewKey(draft, answer.inboundId, true) && answer.text === norm(shortQuestion);
  const confirmed = !!answer && (answer.text === norm(draft.legacyQuestion) || confirmsFull || confirmsShort);
  // A ficha sent before the contract tool was called can already contain the full summary.
  // In that case only ask for issuance, without asking for the data again.
  const current = turns.at(-1);
  return { confirmed, question: useShort ? shortQuestion : draft.question,
    key: current?.direction === 'in' ? reviewKey(draft, current.id, useShort) : undefined };
}
