import { describe, expect, it } from 'vitest';
import { getPath, renderJsonTemplate, renderTemplate } from './template';

describe('renderTemplate', () => {
  it('substitui variáveis simples e aninhadas', () => {
    const out = renderTemplate('Oi {{primeiro_nome}}, seu caso "{{negocio.titulo}}" está em {{ negocio.etapa }}.', {
      primeiro_nome: 'Maria',
      negocio: { titulo: 'Revisão de contrato', etapa: 'Triagem' },
    });
    expect(out).toBe('Oi Maria, seu caso "Revisão de contrato" está em Triagem.');
  });

  it('usa vazio para variáveis ausentes ou nulas', () => {
    expect(renderTemplate('A{{x}}B{{a.b.c}}C', { a: { b: null } })).toBe('ABC');
  });

  it('aceita chave plana com ponto e converte números/booleanos/objetos', () => {
    expect(renderTemplate('{{negocio.titulo}}', { 'negocio.titulo': 'Plano' })).toBe('Plano');
    expect(renderTemplate('{{n}} {{b}} {{o}}', { n: 3, b: true, o: { k: 1 } })).toBe('3 true {"k":1}');
  });

  it('devolve vazio para modelo vazio', () => {
    expect(renderTemplate('', { a: 1 })).toBe('');
  });
});

describe('renderJsonTemplate', () => {
  it('devolve objeto quando o resultado é JSON válido, escapando os valores', () => {
    const out = renderJsonTemplate('{"nome": "{{contact.name}}", "evento": "{{event}}"}', {
      contact: { name: 'João "Jota"\nSilva' },
      event: 'finished',
    });
    expect(out).toEqual({ nome: 'João "Jota"\nSilva', evento: 'finished' });
  });

  it('devolve a string renderizada quando não é JSON', () => {
    expect(renderJsonTemplate('Lead {{nome}} encerrado', { nome: 'Ana' })).toBe('Lead Ana encerrado');
  });

  it('campo que é só uma variável ausente vira null (não string vazia)', () => {
    const out = renderJsonTemplate(
      '{"email": "{{contact.email}}", "cpf": "{{deal.custom_fields.cpf}}", "nome": "{{contact.name}}", "obs": "{{contact.obs}}"}',
      { contact: { name: 'Ana', email: null, obs: '' }, deal: { custom_fields: {} } }
    );
    // ausente/null -> null; string vazia vinda do DADO continua string
    expect(out).toEqual({ email: null, cpf: null, nome: 'Ana', obs: '' });
  });

  it('variável dentro de um texto maior continua virando string vazia', () => {
    expect(renderJsonTemplate('{"msg": "Olá {{contact.name}}!"}', { contact: {} })).toEqual({ msg: 'Olá !' });
  });
});

describe('getPath', () => {
  it('resolve caminhos e devolve undefined fora do objeto', () => {
    expect(getPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
  });
});
