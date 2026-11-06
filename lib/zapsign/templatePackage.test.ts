import mammoth from 'mammoth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapSignClient, ZapSignError, type ZapSignTemplate } from './client';
import { createTemplatePackage, officeTemplates } from './templatePackage';
import { readContractTemplate } from './templateFile';

const extras = ['Procuração', 'Declaração', 'Honorários'].map((name, i) => ({
  token: 'm' + i, name: name + '.docx', template_file: 'https://files.invalid/' + i, template_type: 'docx',
}));
const main = { token: 'principal', name: 'Rede social sem representante', template_file: 'https://files.invalid/main', extra_templates: extras };
const doc = { token: 'doc', name: 'Pacote', status: 'pending', signers: [{ token: 'cliente', name: 'Teste', status: 'new', sign_url: 'https://sign.invalid/cliente' }] };
const input = { template_id: main.token, signer_name: 'Teste', data: [{ de: '{{CPF}}', para: 'fictício' }] };
afterEach(() => vi.restoreAllMocks());

describe('modelo composto do escritório', () => {
  it('exclui os anexos listados em outra página e preserva um modelo avulso de mesmo nome', async () => {
    const single = { ...extras[0], token: 'avulso' };
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({results: [single, ...extras], next: 'page2'}))
      .mockResolvedValueOnce(Response.json({results: [main], next: null}));
    const client = new ZapSignClient({token:'fake', sandbox:true, fetchImpl});
    expect(officeTemplates(await client.listTemplates()).map(t => t.token)).toEqual(['principal', 'avulso']);
  });

  it('junta campos de todos os arquivos uma vez e exige novo aceite se mudar só um anexo', async () => {
    const documents = ['{{NOME}}', '{{NOME}} {{CPF}}', '{{RENDA}}', '{{VALOR}}'];
    const client = new ZapSignClient({token:'fake', sandbox:true, fetchImpl: async url => {
      const key = String(url).split('/').at(-1)!;
      return new Response(documents[key === 'main' ? 0 : Number(key) + 1]);
    }});
    vi.spyOn(mammoth,'extractRawText').mockImplementation(async (source) => ({
      value: (source as {buffer:Buffer}).buffer.toString(), messages: [],
    }));
    vi.spyOn(client,'getTemplate').mockResolvedValue({...main,inputs:[{variable:'{{CAMPO DO FORMULÁRIO}}'}]});
    const first = await readContractTemplate(client, main);
    expect(first.names).toEqual(['CAMPO DO FORMULÁRIO', 'NOME', 'CPF', 'RENDA', 'VALOR']);
    documents[3] += ' cláusula diferente';
    expect((await readContractTemplate(client,main)).revision).not.toBe(first.revision);
  });

  it('abre um único envelope, preserva um anexo nativo e preenche os faltantes sem disparar convites', async () => {
    const calls: Array<{url:string; method:string; body: Record<string,unknown>}> = [];
    const attached = [{token:'native',name:'Procuração.pdf'}];
    const client = new ZapSignClient({token:'fake', sandbox:true, fetchImpl: async (url,opts) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(opts?.body || '{}'));
      calls.push({url:path,method:String(opts?.method),body});
      if(path.endsWith('/create-doc/')) return Response.json(doc);
      if(path.endsWith('/docs/doc/')) return Response.json({...doc, extra_docs:attached});
      if(path.endsWith('/models/doc/upload-extra-doc/')) {
        const item = {token:'attached-' + body.template_id, name:'Anexo'};
        attached.push(item); return Response.json(item);
      }
      throw new Error('Chamada inesperada');
    }});
    const result = await createTemplatePackage(client, main, {...input, send_automatic_whatsapp:true});
    expect(result.signers.map(s => s.sign_url)).toEqual(['https://sign.invalid/cliente']);
    expect(result.extra_docs).toHaveLength(3);
    const posts = calls.filter(c=>c.method==='POST');
    expect(posts.map(c=>c.body.template_id)).toEqual(['principal','m1','m2']);
    expect(posts.map(c=>c.body.data)).toEqual([input.data,input.data,input.data]);
    expect(posts[0].body).toMatchObject({send_automatic_whatsapp:false,send_automatic_email:false});
  });
  it('mantém o mapeamento disponível e informa a limitação de produção quando o detalhe devolve 402', async () => {
    const client = new ZapSignClient({token:'fake',sandbox:true,fetchImpl:async () => { throw new Error('Rede proibida'); }});
    vi.spyOn(client,'getTemplate').mockRejectedValue(new ZapSignError('Plano de API',402));
    vi.spyOn(client,'download').mockResolvedValue({bytes:new Uint8Array([1]),contentType:null});
    vi.spyOn(mammoth,'extractRawText').mockResolvedValue({value:'{{NOME}}',messages:[]});
    expect(await readContractTemplate(client,main)).toMatchObject({planNotice:expect.stringMatching(/plano de API/), names:['NOME']});
  });

  it('não adiciona nem libera um pacote cuja composição não pode ser identificada', async () => {
    const client = new ZapSignClient({token:'fake',sandbox:true,fetchImpl:async () => { throw new Error('Rede proibida'); }});
    vi.spyOn(client,'createDocFromTemplate').mockResolvedValue(doc);
    vi.spyOn(client,'getDoc').mockResolvedValue({...doc,extra_docs:[{token:'unknown',name:'Outro.pdf'}]});
    const add = vi.spyOn(client,'attachTemplate');
    await expect(createTemplatePackage(client,main,input)).rejects.toMatchObject({docToken:doc.token});
    expect(add).not.toHaveBeenCalled();
  });

  it('preserva a criação simples sem chamadas de anexo', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json(doc));
    const client = new ZapSignClient({token:'fake',sandbox:true,fetchImpl});
    const single: ZapSignTemplate = {token:input.template_id,name:'Avulso'};
    expect(await createTemplatePackage(client,single,input)).toEqual(doc);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
