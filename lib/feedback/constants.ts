export const FEEDBACK_BUCKET = 'feedback-anexos';

export const FEEDBACK_STATUSES = [
  'recebido', 'em_analise', 'precisa_detalhes', 'na_fila', 'aguardando_aprovacao',
  'em_correcao', 'corrigido', 'nao_e_bug', 'descartado',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_KINDS = ['bug', 'melhoria', 'ambos'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const ATTACHMENT_KINDS = ['image', 'audio', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  recebido: 'Recebido',
  em_analise: 'Em análise',
  precisa_detalhes: 'Precisamos de mais informações',
  na_fila: 'Na fila',
  aguardando_aprovacao: 'Aguardando aprovação',
  em_correcao: 'Em correção',
  corrigido: 'Corrigido',
  nao_e_bug: 'Não é bug',
  descartado: 'Descartado',
};

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: 'Bug', melhoria: 'Melhoria', ambos: 'Os dois',
};

export const FEEDBACK_LIMITS = {
  bodyChars: 4000,
  transcriptChars: 8000,
  images: 10,
  files: 5,
  audios: 1,
  bytes: 10 * 1024 * 1024,
  audioSeconds: 180,
  perDay: 20,
  /** Pedidos de URL de upload por usuário, por minuto (limitador em memória de cada instância). */
  uploadsPerMinute: 30,
} as const;

export const ALLOWED_MIME: Record<AttachmentKind, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav'],
  file: [
    'application/pdf', 'text/plain', 'text/csv',
    // O Windows declara arquivos .csv com o tipo da planilha antiga do Excel.
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};
