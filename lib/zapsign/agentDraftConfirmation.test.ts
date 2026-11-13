import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contractReview, prepareAgentDraft, type ContractTurn } from './agentDraft';

const at = new Date().toISOString();
const inbound = (id: string, text: string): ContractTurn => ({ id, direction: 'in', text, agent: false, ok: true, at });
const outbound = (id: string, text: string): ContractTurn => ({ id, direction: 'out', text, agent: true, ok: true, at });
const first = inbound('1', 'Enviei a ficha.');
const input = {
  scope: ['simulacao'], template: { name: 'Modelo', revision: '1', names: [] }, signer: 'Maria Silva', fields: [], supplied: {},
  ctx: { contact: { name: 'Maria Silva', phone: '+5511999991111', company: '', email: '' }, organizationName: 'Escritório de teste',
    deal: { title: '', stage: '', board: '', value: null, owner: '', description: '', customFields: {}, items: [] } },
};
const draft = prepareAgentDraft({ ...input, turns: [first] });
const key = contractReview([first], draft).key;
const review = (reply: string, question = draft.question) =>
  contractReview([first, outbound('2', question), inbound('3', reply)], draft, key);

describe('resposta à conferência da ficha', () => {
  it('pede só o número contestado e reconstrói a ficha após uma resposta curta à pergunta sobre o número', () => {
    const name = 'ENDEREÇO COMPLETO';
    const source = 'Rua das Acácias, 88, Vila Nova, Campo Grande MS';
    const options = { ...input, template: { ...input.template, names: [name] }, mapping: { [name]: 'cliente:perguntar' } };
    const compose = (turns: ContractTurn[], supplied: Record<string, string> = {}) =>
      prepareAgentDraft({ ...options, turns, supplied });
    const start = inbound('1', source);
    const original = compose([start], { [name]: source });
    const disputed = [start, outbound('2', original.question), inbound('3', 'O número da casa está errado')];
    expect(compose(disputed).missing).toEqual(['Número da casa']);
    const restated = [...disputed, outbound('4', 'Qual é o endereço correto?'),
      inbound('5', 'Meu endereço correto é Rua das Acácias, 98, Vila Nova, Campo Grande MS')];
    expect(compose(restated).data[0].para).toBe(source.replace('88', '98'));
    expect(contractReview(restated, compose(restated)).confirmed).toBe(false);
    const asked = [...disputed, outbound('4', 'Qual é o número correto da casa?')];
    expect(compose([...asked, inbound('5', 'Pode gerar')]).missing).toEqual(['Número da casa']);
    const clarified = [...asked, inbound('5', '98')];
    const revised = compose(clarified);
    expect(revised.missing).toEqual([]);
    expect(revised.data[0].para).toBe(source.replace('88', '98'));
    expect(contractReview(clarified, revised, contractReview([start], original).key).confirmed).toBe(false);
  });

  it('reaplica correções sucessivas apenas à última versão do endereço até a nova ficha ser aceita', () => {
    const name = 'Endereço';
    const source = 'Rua Aurora, 88, Vila Nova, Campo Grande MS';
    const initial = inbound('1', source);
    const compose = (turns: ContractTurn[], address?: string) => prepareAgentDraft({ ...input, turns,
      template: { ...input.template, names: [name] }, supplied: address ? { [name]: address } : {} });
    const firstDraft = compose([initial], source);
    const firstEdit = [initial, outbound('2', firstDraft.question), inbound('3', 'O número da casa é 98 e não 88')];
    const secondDraft = compose(firstEdit);
    const secondEdit = [...firstEdit, outbound('4', secondDraft.question), inbound('5', 'O número da casa não é 98, é 108')];
    const lastDraft = compose(secondEdit, source);
    expect(lastDraft.data[0].para).toBe(source.replace('88', '108'));
    const current = contractReview(secondEdit, lastDraft);
    const confirmed = [...secondEdit, outbound('6', current.question), inbound('7', 'Tudo certo!')];
    expect(contractReview(confirmed, compose(confirmed), current.key).confirmed).toBe(true);
    expect(contractReview(confirmed, compose(confirmed), contractReview(firstEdit, secondDraft).key).confirmed).toBe(false);
  });

  it('preserva a confirmação de uma ficha já apresentada antes da atualização', () => {
    const options = { ...input, template: { ...input.template, names: ['Endereço'] },
      mapping: { Endereço: 'cliente:perguntar' }, supplied: { Endereço: 'Rua das Flores, 10' } };
    const conversation = [inbound('1', 'Moro na Rua das Flores, 10')];
    const previous = prepareAgentDraft({ ...options, turns: conversation });
    const hash = (values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
    const previousKey = hash([hash([input.scope, input.template.revision, previous.identity, previous.data]), '1', false]);
    const turns = [...conversation, outbound('2', previous.question), inbound('3', 'Pode emitir o contrato!')];
    expect(contractReview(turns, prepareAgentDraft({ ...options, turns }), previousKey).confirmed).toBe(true);
    const changed = prepareAgentDraft({ ...options, template: { ...options.template, revision: '2' }, turns });
    expect(contractReview(turns, changed, previousKey).confirmed).toBe(false);
  });
  it.each(['Conferi tudo, os dados estão todos corretos. Pode emitir o contrato.',
    'Eu confirmo meus dados', 'Pra mim tá tudo certo!', 'Os dados conferem. Obrigada 👍🏽', 'A ficha confere com meus dados.',
    'Isso, pode sim', 'Está tudo correto', 'Sim, esses são meus dados', 'Sim senhora'])(
    'aceita confirmação contextual: %s', reply => expect(review(reply).confirmed).toBe(true),
  );
  it.each(['Tudo certo?', 'Conferi a ficha', 'Não tenho dúvidas.', 'Pode fazer, mas quero mudar meu CEP.',
    'Confirmo 👎', 'Sim, acho que os dados estão certos', 'Eu confirmo meus dados anteriores, esses não'])(
    'não emite na dúvida ou com ressalva: %s', reply => expect(review(reply).confirmed).toBe(false),
  );
  it.each(['Mais uma coisa: você já recebeu outro contrato?', 'Vou substituir seu endereço pelo do seu representante.',
    'Seu CPF ficou diferente no contrato.', 'Quer revisar os dados com a equipe?'])(
    'não aproveita aceite após mudança de assunto: %s',
    tail => expect(review('Sim', draft.question + '\n' + tail).confirmed).toBe(false),
  );
  it('reconhece a ficha estruturada, a pergunta e a dica de responder por áudio', () => {
    const question = '• *Nome completo:* Maria Silva\n• *Telefone:* +5511999991111\n• *Endereço:* Av. Paulista, 10\nPode me confirmar os dados acima? Se preferir, pode responder por áudio.';
    const fromPhoto = { ...input, template: { ...input.template, names: ['Endereço'] }, mapping: { Endereço: 'cliente:perguntar' } };
    const from = (text: string) => prepareAgentDraft({ ...fromPhoto, turns: [first, outbound('2', text), inbound('3', 'Conferi e tá certinho!')] });
    expect(from(question).data).toEqual([{ de: '{{Endereço}}', para: 'Av. Paulista, 10' }]);
    expect(from(question.replace('Pode me confirmar os dados acima?', 'Os dados estão corretos.')).missing).toContain('Endereço');
    expect(from(question + ' Você já usa a ZapSign?').missing).toContain('Endereço');
  });

  it('delimita os dados da ficha antes de uma pergunta na mesma linha', () => {
    const question = 'Ficha. Nome: Maria Silva. Telefone: +5511999991111. Endereço: Rua do Sol, 81. Pode me confirmar se está tudo certo?';
    const result = prepareAgentDraft({ ...input, template: { ...input.template, names: ['Endereço'] }, mapping: { Endereço: 'cliente:perguntar' },
      turns: [first, outbound('2', question), inbound('3', 'Confirmo, sim!')] });
    expect(result.data).toEqual([{ de: '{{Endereço}}', para: 'Rua do Sol, 81' }]);
  });
});
