/**
 * Variáveis do modelo da ZapSign ({{NOME}}, {{VALOR}}...) e de onde cada uma
 * vem no CRM. Puro (sem banco): serve ao servidor e à tela de configuração.
 *
 * Origem de uma variável (texto gravado na regra):
 *   "contato.nome"      campo fixo do CRM (ver SOURCE_CATALOG)
 *   "campo:cpf"         campo personalizado do lead com a chave cpf
 *   "texto:São Paulo"   valor fixo
 *   ""                  fica em branco (a ZapSign pode pedir ao assinar)
 */

export type VariableSource = string;

export type SourceOption = { value: string; label: string; group: string };

export const SOURCE_CATALOG: SourceOption[] = [
  { value: 'contato.nome', label: 'Nome do contato', group: 'Contato' },
  { value: 'contato.primeiro_nome', label: 'Primeiro nome', group: 'Contato' },
  { value: 'contato.email', label: 'E-mail', group: 'Contato' },
  { value: 'contato.telefone', label: 'Telefone', group: 'Contato' },
  { value: 'contato.empresa', label: 'Empresa do contato', group: 'Contato' },
  { value: 'negocio.titulo', label: 'Título do lead', group: 'Negócio' },
  { value: 'negocio.valor', label: 'Valor (R$ 1.234,56)', group: 'Negócio' },
  { value: 'negocio.valor_numero', label: 'Valor (1234.56)', group: 'Negócio' },
  { value: 'negocio.valor_extenso', label: 'Valor por extenso', group: 'Negócio' },
  { value: 'negocio.produtos', label: 'Produtos (nome, quantidade e preço)', group: 'Negócio' },
  { value: 'negocio.produtos_nomes', label: 'Produtos (só os nomes)', group: 'Negócio' },
  { value: 'negocio.etapa', label: 'Etapa atual', group: 'Negócio' },
  { value: 'negocio.funil', label: 'Funil', group: 'Negócio' },
  { value: 'negocio.responsavel', label: 'Responsável pelo lead', group: 'Negócio' },
  { value: 'negocio.descricao', label: 'Descrição do lead', group: 'Negócio' },
  { value: 'escritorio.nome', label: 'Nome da organização', group: 'Escritório' },
  { value: 'data.hoje', label: 'Data de hoje (27/10/2026)', group: 'Data' },
  { value: 'data.hoje_extenso', label: 'Data por extenso (27 de outubro de 2026)', group: 'Data' },
  { value: 'data.ano', label: 'Ano', group: 'Data' },
];

export type VariableContext = {
  contact: { name: string; email: string; phone: string; company: string };
  deal: {
    title: string;
    value: number | null;
    items: Array<{ name: string; quantity: number; price: number }>;
    stage: string;
    board: string;
    owner: string;
    description: string;
    customFields: Record<string, unknown>;
  };
  /** definições dos campos personalizados (chave -> tipo) para formatar */
  customFieldTypes?: Record<string, string>;
  organizationName: string;
  now?: Date;
};

const BRL = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Extrai {{variáveis}} de um texto (o conteúdo do DOCX, por exemplo), sem repetir, na ordem. */
export function extractTemplateVariables(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // o Word pode quebrar "{{NOME}}" em trechos com espaços; aceita espaços internos
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function normalizeVarName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const AUTO_MATCH: Array<[RegExp, string]> = [
  [/^(nome(completo)?|nomedocliente|cliente|contratante|nomecontratante|outorgante)$/, 'contato.nome'],
  [/^primeironome$/, 'contato.primeiro_nome'],
  [/^(email|emaildocliente|emailcontratante)$/, 'contato.email'],
  [/^(telefone|celular|whatsapp|fone|telefonedocliente)$/, 'contato.telefone'],
  [/^(valor|valortotal|honorarios|valordoshonorarios|valorhonorarios|preco)$/, 'negocio.valor'],
  [/^(valorextenso|valorporextenso|honorariosextenso)$/, 'negocio.valor_extenso'],
  [/^(produto|produtos|servico|servicos|objeto|objetodocontrato)$/, 'negocio.produtos_nomes'],
  [/^(data|datadehoje|dataatual|hoje)$/, 'data.hoje'],
  [/^(dataextenso|datadehojeextenso|dataporextenso)$/, 'data.hoje_extenso'],
  [/^ano$/, 'data.ano'],
  [/^(advogado|responsavel|advogadoresponsavel|vendedor|consultor)$/, 'negocio.responsavel'],
  [/^(escritorio|contratada|contratado|empresa|nomedoescritorio|razaosocial)$/, 'escritorio.nome'],
  [/^(etapa|fase)$/, 'negocio.etapa'],
  [/^(titulo|tituloldolead|negocio|caso)$/, 'negocio.titulo'],
];

/**
 * Sugere a origem de uma variável pelo nome: campos fixos conhecidos ou um
 * campo personalizado com a mesma chave/rótulo. Sem palpite, fica em branco.
 */
export function autoMatchVariable(varName: string, customFields: Array<{ key: string; label: string }>): VariableSource {
  const n = normalizeVarName(varName);
  if (!n) return '';
  for (const f of customFields) {
    if (normalizeVarName(f.key) === n || normalizeVarName(f.label) === n) return `campo:${f.key}`;
  }
  for (const [re, source] of AUTO_MATCH) if (re.test(n)) return source;
  return '';
}

function formatCustomField(value: unknown, type: string | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'currency') return BRL(Number(value));
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  return String(value);
}

/** Valor por extenso em reais (até bilhões), para contratos. */
export function valorPorExtenso(valor: number): string {
  const v = Math.round(Math.abs(Number(valor) || 0) * 100) / 100;
  const inteiro = Math.floor(v);
  const centavos = Math.round((v - inteiro) * 100);
  const un = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dez = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const cen = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = (n: number): string => {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100);
    const r = n % 100;
    const parts: string[] = [];
    if (c) parts.push(cen[c]);
    if (r < 20) {
      if (r) parts.push(un[r]);
    } else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      parts.push(u ? `${dez[d]} e ${un[u]}` : dez[d]);
    }
    return parts.join(' e ');
  };
  const grupos: Array<[number, string, string]> = [
    [1_000_000_000, 'bilhão', 'bilhões'],
    [1_000_000, 'milhão', 'milhões'],
    [1_000, 'mil', 'mil'],
  ];
  let resto = inteiro;
  const partes: Array<{ q: number; texto: string }> = [];
  for (const [base, sing, plur] of grupos) {
    const q = Math.floor(resto / base);
    if (q) {
      partes.push({ q, texto: base === 1000 && q === 1 ? 'mil' : `${ate999(q)} ${q === 1 ? sing : plur}` });
      resto %= base;
    }
  }
  if (resto) partes.push({ q: resto, texto: ate999(resto) });
  // "e" só antes do último grupo quando ele é menor que cem ou centena redonda
  // (quatro mil e quinhentos; quatro mil quinhentos e cinquenta; um milhão e duzentos mil)
  let texto = '';
  partes.forEach((p, i) => {
    if (i === 0) texto = p.texto;
    else texto += (i === partes.length - 1 && (p.q < 100 || p.q % 100 === 0) ? ' e ' : ' ') + p.texto;
  });
  if (!texto) texto = 'zero';
  texto += inteiro === 1 ? ' real' : ' reais';
  if (centavos) texto += ` e ${ate999(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return texto;
}

/** Resolve a origem de UMA variável para texto. */
export function resolveSource(source: VariableSource, ctx: VariableContext): string {
  const s = (source ?? '').trim();
  if (!s) return '';
  if (s.startsWith('texto:')) return s.slice(6);
  if (s.startsWith('campo:')) {
    const key = s.slice(6);
    return formatCustomField(ctx.deal.customFields?.[key], ctx.customFieldTypes?.[key]);
  }
  const now = ctx.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (s) {
    case 'contato.nome':
      return ctx.contact.name;
    case 'contato.primeiro_nome':
      return ctx.contact.name.trim().split(/\s+/)[0] ?? '';
    case 'contato.email':
      return ctx.contact.email;
    case 'contato.telefone':
      return ctx.contact.phone;
    case 'contato.empresa':
      return ctx.contact.company;
    case 'negocio.titulo':
      return ctx.deal.title;
    case 'negocio.valor':
      return ctx.deal.value === null ? '' : BRL(ctx.deal.value);
    case 'negocio.valor_numero':
      return ctx.deal.value === null ? '' : String(Math.round(ctx.deal.value * 100) / 100);
    case 'negocio.valor_extenso':
      return ctx.deal.value === null ? '' : valorPorExtenso(ctx.deal.value);
    case 'negocio.produtos':
      return ctx.deal.items.map((i) => `${i.name} (${i.quantity} x ${BRL(i.price)})`).join('; ');
    case 'negocio.produtos_nomes':
      return ctx.deal.items.map((i) => i.name).join(', ');
    case 'negocio.etapa':
      return ctx.deal.stage;
    case 'negocio.funil':
      return ctx.deal.board;
    case 'negocio.responsavel':
      return ctx.deal.owner;
    case 'negocio.descricao':
      return ctx.deal.description;
    case 'escritorio.nome':
      return ctx.organizationName;
    case 'data.hoje':
      return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    case 'data.hoje_extenso':
      return `${now.getDate()} de ${MONTHS[now.getMonth()]} de ${now.getFullYear()}`;
    case 'data.ano':
      return String(now.getFullYear());
    default:
      return '';
  }
}

/** Todas as variáveis do modelo resolvidas, no formato que a ZapSign espera. */
export function resolveVariables(
  mapping: Record<string, VariableSource>,
  ctx: VariableContext,
  overrides: Record<string, string> = {}
): Array<{ de: string; para: string }> {
  return Object.entries(mapping).map(([name, source]) => ({
    de: `{{${name}}}`,
    para: name in overrides ? overrides[name] : resolveSource(source, ctx),
  }));
}

/** "+5511999990000" -> { country: "55", number: "11999990000" } (vazio quando não dá para separar). */
export function splitPhone(e164: string): { country: string; number: string } {
  const digits = (e164 ?? '').replace(/\D/g, '');
  if (!digits) return { country: '', number: '' };
  // Brasil: 55 + DDD (2) + 8 ou 9 dígitos
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return { country: '55', number: digits.slice(2) };
  // demais países: códigos de 1 a 3 dígitos; tenta do mais comum ao menor
  const known = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '351', '352', '353', '354', '355', '358', '359', '370', '371', '372', '373', '374', '375', '376', '377', '380', '381', '385', '386', '387', '389', '420', '421', '423', '591', '593', '595', '598', '852', '853', '855', '856', '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968', '971', '972', '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998'];
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (known.includes(cc) && digits.length > len + 5) return { country: cc, number: digits.slice(len) };
  }
  return { country: '', number: digits };
}
