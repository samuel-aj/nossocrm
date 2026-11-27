import { describe, expect, it } from 'vitest';
import { CreateFeedbackSchema, UploadRequestSchema, ReplySchema } from './schemas';

const image = { path: 'org/user/1_a.png', kind: 'image', mime: 'image/png', size: 1000 } as const;

describe('CreateFeedbackSchema', () => {
  it('aceita só texto', () => {
    expect(CreateFeedbackSchema.safeParse({ body: 'O botão some' }).success).toBe(true);
  });
  it('aceita só um print', () => {
    expect(CreateFeedbackSchema.safeParse({ body: '', attachments: [image] }).success).toBe(true);
  });
  it('aceita só a transcrição', () => {
    expect(CreateFeedbackSchema.safeParse({ body: ' ', transcript: 'Queria filtro por data' }).success).toBe(true);
  });
  it('recusa envio vazio', () => {
    expect(CreateFeedbackSchema.safeParse({ body: '   ' }).success).toBe(false);
  });
  it('recusa mais de 10 imagens', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...image, path: `org/user/${i}_a.png` }));
    expect(CreateFeedbackSchema.safeParse({ body: 'x', attachments: many }).success).toBe(false);
  });
  it('recusa mais de 5 arquivos', () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ path: `org/user/${i}_a.pdf`, kind: 'file', mime: 'application/pdf', size: 10 }));
    expect(CreateFeedbackSchema.safeParse({ body: 'x', attachments: files }).success).toBe(false);
  });
  it('recusa mais de um áudio', () => {
    const audio = { path: 'org/user/1_a.mp3', kind: 'audio', mime: 'audio/mpeg', size: 10 };
    expect(CreateFeedbackSchema.safeParse({ body: 'x', attachments: [audio, { ...audio, path: 'org/user/2_a.mp3' }] }).success).toBe(false);
  });
  it('recusa tipo desconhecido', () => {
    expect(CreateFeedbackSchema.safeParse({ body: 'x', kind: 'duvida' }).success).toBe(false);
  });
  it('recusa campo a mais', () => {
    expect(CreateFeedbackSchema.safeParse({ body: 'x', status: 'corrigido' }).success).toBe(false);
  });
});

describe('UploadRequestSchema', () => {
  it('aceita imagem de até 10 MB', () => {
    expect(UploadRequestSchema.safeParse({ fileName: 'a.png', mime: 'image/png', size: 10 * 1024 * 1024, kind: 'image' }).success).toBe(true);
  });
  it('recusa arquivo maior que 10 MB', () => {
    expect(UploadRequestSchema.safeParse({ fileName: 'a.png', mime: 'image/png', size: 10 * 1024 * 1024 + 1, kind: 'image' }).success).toBe(false);
  });
  it('aceita CSV declarado como text/csv ou como planilha do Excel antigo (Windows)', () => {
    for (const mime of ['text/csv', 'application/vnd.ms-excel']) {
      expect(UploadRequestSchema.safeParse({ fileName: 'leads.csv', mime, size: 10, kind: 'file' }).success).toBe(true);
      expect(CreateFeedbackSchema.safeParse({ body: '', attachments: [{ path: 'org/user/1_leads.csv', kind: 'file', mime, size: 10 }] }).success).toBe(true);
    }
    expect(UploadRequestSchema.safeParse({ fileName: 'leads.csv', mime: 'application/vnd.ms-excel', size: 10, kind: 'image' }).success).toBe(false);
  });
  it('recusa tipo de arquivo que não combina com o kind', () => {
    expect(UploadRequestSchema.safeParse({ fileName: 'a.exe', mime: 'application/x-msdownload', size: 10, kind: 'file' }).success).toBe(false);
    expect(UploadRequestSchema.safeParse({ fileName: 'a.pdf', mime: 'application/pdf', size: 10, kind: 'image' }).success).toBe(false);
  });
});

describe('ReplySchema', () => {
  it('exige texto', () => {
    expect(ReplySchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(ReplySchema.safeParse({ body: 'Acontece na tela do lead' }).success).toBe(true);
  });
});
