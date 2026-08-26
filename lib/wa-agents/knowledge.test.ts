import { describe, expect, it } from 'vitest';
import { chunkText, cleanExtractedText, extractDocumentText, formatKnowledgeHits, resolveDocumentMime } from './knowledge';

/** PDF mínimo escrito à mão com uma linha de texto (o pdf.js tolera o xref simples). */
function buildTinyPdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('resolveDocumentMime', () => {
  it('aceita os mimes suportados e deduz pela extensão quando o navegador manda genérico', () => {
    expect(resolveDocumentMime('application/pdf', 'x.pdf')).toBe('application/pdf');
    expect(resolveDocumentMime('text/plain; charset=utf-8', 'x.txt')).toBe('text/plain');
    expect(resolveDocumentMime('application/octet-stream', 'guia.md')).toBe('text/markdown');
    expect(resolveDocumentMime('', 'Contrato.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(resolveDocumentMime('image/png', 'foto.png')).toBeNull();
    expect(resolveDocumentMime('application/octet-stream', 'planilha.xlsx')).toBeNull();
  });
});

describe('chunkText', () => {
  it('mantém parágrafos curtos juntos e não corta palavras', () => {
    const paras = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i + 1} com algumas palavras para testar a divisão.`);
    const chunks = chunkText(paras.join('\n\n'), { size: 300, overlap: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(300);
      // começa e termina em palavra inteira
      expect(c).toMatch(/^\S/);
      expect(c).toMatch(/\S$/);
    }
    // todo o conteúdo aparece em algum trecho
    for (const p of paras) expect(chunks.some(c => c.includes(p))).toBe(true);
  });

  it('sobrepõe o fim do trecho anterior no seguinte', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Frase número ${i + 1} termina aqui.`);
    const chunks = chunkText(sentences.join(' '), { size: 200, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(2);
    const lastWordsOfFirst = chunks[0].split(' ').slice(-3).join(' ');
    expect(chunks[1].startsWith(lastWordsOfFirst.split(' ')[0]) || chunks[1].includes(lastWordsOfFirst)).toBe(true);
  });

  it('quebra palavras gigantes sem estourar o tamanho e devolve [] para vazio', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
    const long = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(' ');
    const chunks = chunkText(long, { size: 120, overlap: 20 });
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    expect(chunks.join(' ')).toContain('palavra199');
  });

  it('limpa caracteres de controle e espaços repetidos', () => {
    expect(cleanExtractedText('a\u0000b   c \t\r\nd\n\n\n\ne')).toBe('ab c\nd\n\ne');
  });
});

describe('extractDocumentText', () => {
  it('lê texto e markdown em utf-8 (removendo o BOM)', async () => {
    const txt = Buffer.from('\uFEFFOlá, mundo.\r\nSegunda linha.', 'utf-8');
    expect(await extractDocumentText(txt, 'text/plain', 'a.txt')).toBe('Olá, mundo.\nSegunda linha.');
    const md = Buffer.from('# Título\n\nTexto **em** markdown.', 'utf-8');
    expect(await extractDocumentText(md, 'application/octet-stream', 'guia.md')).toContain('Título');
  });

  it('extrai o texto de um PDF com unpdf', async () => {
    const text = await extractDocumentText(buildTinyPdf('Ola mundo do PDF'), 'application/pdf', 'x.pdf');
    expect(text).toContain('Ola mundo do PDF');
  });

  it('rejeita tipos não suportados', async () => {
    await expect(extractDocumentText(Buffer.from('x'), 'image/png', 'x.png')).rejects.toThrow('não suportado');
  });
});

describe('formatKnowledgeHits', () => {
  it('numera os trechos, mostra o nome do documento e respeita o limite', () => {
    const out = formatKnowledgeHits(
      [
        { content: 'Trecho   um\ncom quebra', document_id: 'd1', idx: 0, score: 0.9 },
        { content: 'Trecho dois', document_id: 'd2', idx: 3, score: 0.5 },
      ],
      [{ id: 'd1', name: 'Guia.pdf' }]
    );
    expect(out).toBe('[1] (Guia.pdf) Trecho um com quebra\n[2] Trecho dois');
    expect(formatKnowledgeHits([], [])).toBe('');
    expect(formatKnowledgeHits([{ content: 'x'.repeat(100), document_id: 'd', idx: 0, score: 1 }], [], 50)).toBe('');
  });
});
