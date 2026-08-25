/**
 * Modelos de mensagem: variáveis compartilhadas entre a UI (aba Modelos, chat)
 * e o servidor (criação de templates na Meta via Evolution).
 *
 * - Modelo GERAL: o corpo com {{contato.nome}} etc. é preenchido com os dados
 *   reais do lead/contato na hora de usar no chat (fillTemplate).
 * - Modelo WHATSAPP API: a Meta não aceita variáveis nomeadas — o corpo é
 *   convertido pra placeholders numerados ({{1}}, {{2}}...) na criação do
 *   template (toMetaBody), preservando a ordem de aparição.
 */

export interface TemplateVariable {
  key: string;
  label: string;
  sample: string;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: '{{contato.nome}}', label: 'Nome do contato', sample: 'Maria Silva' },
  { key: '{{contato.telefone}}', label: 'Telefone do contato', sample: '(66) 99999-0000' },
  { key: '{{contato.email}}', label: 'Email do contato', sample: 'maria@exemplo.com' },
  { key: '{{lead.titulo}}', label: 'Título do lead', sample: 'BPC LOAS' },
  { key: '{{lead.valor}}', label: 'Valor do lead', sample: 'R$ 6.500,00' },
  { key: '{{lead.etapa}}', label: 'Etapa do lead', sample: 'Em Qualificação' },
  { key: '{{responsavel.nome}}', label: 'Responsável pelo lead', sample: 'Dra. Ana' },
  { key: '{{escritorio.nome}}', label: 'Nome do escritório', sample: 'Seu Escritório' },
];

/** Corpo com os valores de exemplo (prévia na aba Modelos). */
export function previewTemplate(body: string): string {
  let out = body;
  for (const v of TEMPLATE_VARIABLES) out = out.split(v.key).join(v.sample);
  return out;
}

/**
 * Preenche o corpo com valores REAIS (uso no chat). Chaves ausentes viram ''.
 * `values` usa a chave sem chaves: 'contato.nome' -> 'Maria'.
 */
export function fillTemplate(body: string, values: Record<string, string | undefined>): string {
  let out = body;
  for (const v of TEMPLATE_VARIABLES) {
    const bare = v.key.replace(/[{}]/g, '');
    out = out.split(v.key).join((values[bare] ?? '').trim());
  }
  // limpa espaços duplicados deixados por variáveis vazias
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Converte o corpo pro formato da Meta: variáveis nomeadas viram {{1}},{{2}}...
 * na ORDEM DE APARIÇÃO (variável repetida usa o mesmo número). Devolve também
 * os exemplos exigidos pela Meta quando há placeholders.
 */
export function toMetaBody(body: string): { text: string; variables: string[]; examples: string[] } {
  const order: string[] = [];
  const re = /\{\{(contato|lead|responsavel|escritorio)\.[a-z]+\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!order.includes(m[0])) order.push(m[0]);
  }
  let text = body;
  order.forEach((key, i) => {
    text = text.split(key).join(`{{${i + 1}}}`);
  });
  const examples = order.map(key => TEMPLATE_VARIABLES.find(v => v.key === key)?.sample ?? 'exemplo');
  return { text, variables: order, examples };
}

/**
 * Valores das variáveis na ORDEM dos placeholders {{1}}, {{2}}... do template
 * na Meta (mesma ordem do toMetaBody). A Meta rejeita parâmetro vazio, por
 * isso variável sem valor vira '-'.
 */
export function templateParams(body: string, values: Record<string, string | undefined>): string[] {
  const { variables } = toMetaBody(body);
  return variables.map(key => (values[key.replace(/[{}]/g, '')] ?? '').trim() || '-');
}

/** Botão de template da Meta (só modelos do WhatsApp API). */
export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  /** Rótulo do botão (até 25 caracteres) */
  text: string;
  /** Só URL: link fixo */
  url?: string;
  /** Só PHONE_NUMBER: E.164 (ex.: +5569999999999) */
  phone_number?: string;
}

/** Limites da Meta por template */
export const TEMPLATE_BUTTON_LIMITS = { total: 10, url: 2, phone: 1, textLen: 25 } as const;

export const TEMPLATE_BUTTON_LABEL: Record<TemplateButton['type'], string> = {
  QUICK_REPLY: 'Resposta rápida',
  URL: 'Link',
  PHONE_NUMBER: 'Ligar',
};

/** Nome de template no formato exigido pela Meta: minusculas_com_underscore. */
export function toMetaName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512) || 'modelo';
}
