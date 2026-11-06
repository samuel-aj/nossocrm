import { createHash } from 'node:crypto';
import { autoMatchVariable, canCollectContractField, normalizeVarName, resolveSource, type VariableContext } from './variables';

export type ContractTurn = { direction: 'in' | 'out'; text: string; agent: boolean; ok: boolean; at: string };
export type ContractFields = Record<string, string>;
export type AgentContractInput = { modo: 'preparar' | 'criar'; dados: ContractFields };
const plain = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => plain(s).toLocaleLowerCase('pt-BR');
// Only identification data can come from client messages. Prices, products,
// deadlines and any other office-defined terms must have a source in the CRM.
const personal = /^(?:(?:nome(?:completo)?|cpf|cnpj|rg|email|telefone|celular|whatsapp|endereco|logradouro|bairro|cep|numero|complemento|cidade|estado|uf|nacionalidade|estadocivil|profissao|datanascimento|datadenascimento)(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante))?)$/;

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
      if (fromClient && candidate && evidenced(candidate)) value = candidate;
      else (fromClient ? missing : office).push(name);
    }
    data.push({ de: '{{' + name + '}}', para: value });
  }
  const ref = createHash('sha256').update(JSON.stringify([input.scope, input.template.revision, signer, data])).digest('hex').slice(0, 12);
  const fields = data.map(({ de, para }) => de.slice(2, -2) + ': ' + para).join('; ');
  const question = 'Contrato: ' + plain(input.template.name) + '. Signatário: ' + signer +
    '. ' + (fields ? fields + '. ' : '') + 'Referência ' + ref + '. Posso criar o contrato e enviar o link por aqui?';
  return { data, missing, office, question, signer };
}

export function hasContractConsent(turns: ContractTurn[], question: string, now = Date.now()): boolean {
  const reply = turns.at(-1);
  if (!reply || reply.direction !== 'in' || !reply.ok) return false;
  const affirmative = norm(reply.text).replace(/[.,!]+$/g, '').trim();
  if (!/^(?:sim|confirmo|confirmado|de acordo|autorizo|pode sim|(?:sim[, ]+)?pode(?: (?:criar|gerar|preparar|enviar|mandar)(?: o (?:contrato|documento|link))?)?)$/.test(affirmative)) return false;
  const previous: string[] = [];
  for (let i = turns.length - 2; i >= 0; i--) {
    const t = turns[i];
    if (t.direction !== 'out' || !t.ok || !t.agent || !Number.isFinite(Date.parse(t.at)) ||
        now - Date.parse(t.at) > 86_400_000 || Date.parse(t.at) > Date.parse(reply.at)) break;
    previous.unshift(t.text);
    if (norm(previous.join(' ')) === norm(question)) return true;
  }
  return false;
}
