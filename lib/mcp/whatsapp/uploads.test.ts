import { describe, expect, it, vi } from 'vitest';
import { prepareUploadSchema, sequenceSchema } from './schemas';
import { readBoundedPdf, sha256, validatePdf } from './uploads';
import { sequenceHash } from './journal';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
const expected = { size: pdf.length, sha256: sha256(pdf) };
describe('PDF/text integrity', () => {
  it('validates exact bytes and rejects a different hash, size or file signature', () => {
    expect(() => validatePdf(pdf, expected)).not.toThrow();
    expect(() => validatePdf(pdf, { ...expected, sha256: 'a'.repeat(64) })).toThrow('PDF');
    expect(() => validatePdf(pdf, { ...expected, size: 10 })).toThrow('PDF');
    const exe = Buffer.from('MZ-not-a-pdf');
    expect(() => validatePdf(exe, { size: exe.length, sha256: sha256(exe) })).toThrow('PDF');
  });
  it('enforces filename, MIME, 10 MiB and strict fields without accepting a local path', () => {
    const input = { conversationId: uuid(1), connectionId: uuid(2), fileName: 'Revisão 😊.pdf', mimeType: 'application/pdf', ...expected };
    expect(prepareUploadSchema.parse(input).fileName).toBe(input.fileName);
    for (const invalid of [{ fileName: 'C:/arquivo.pdf' }, { fileName: '../arquivo.pdf' }, { mimeType: 'text/plain' }, { size: 11 * 1024 * 1024 }, { localPath: '/tmp/a.pdf' }]) expect(prepareUploadSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
  });
  it('bounds chunked streams before loading a large file', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel });
    await expect(readBoundedPdf(new Response(stream), expected)).rejects.toThrow('limite');
    expect(cancel).toHaveBeenCalled();
    expect(await readBoundedPdf(new Response(pdf), expected)).toEqual(pdf);
  });
  it('does not trim Unicode paragraphs, markup or whitespace; rejects oversize', () => {
    const text = '  Olá, João!\n\n*Estratégia* → confira 😊\n';
    const input = { operationId: uuid(3), conversationId: uuid(1), connectionId: uuid(2), items: [{ itemId: uuid(4), type: 'text', text }] };
    const parsed = sequenceSchema.parse(input);
    expect(parsed.items[0]).toEqual(input.items[0]);
    expect(sequenceHash(parsed)).not.toBe(sequenceHash(sequenceSchema.parse({ ...input, items: [{ ...input.items[0], text: text.trim() }] })));
    expect(sequenceSchema.safeParse({ ...input, items: [{ ...input.items[0], text: 'a'.repeat(4097) }] }).success).toBe(false);
  });
});
