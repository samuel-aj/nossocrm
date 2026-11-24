import type { ConfirmedOabRegistration } from './oabRegistry';
import { OAB_STATES } from './oabRegistry';
import type { ReplySegment } from './replyOutput';

const topic = /\b(?:o[.\s_-]*a[.\s_-]*b|ordem (?:d[oa]s? )?advogad[oa]s?|(?:carteira|carteirinha|registro|inscricao)(?: profissional| (?:na ordem|d[ao] advocaci[ao]|(?:d[aeo] |de )advogad[oa]))|(?:minha|meu) (?:inscricao|registro) (?:e|profissional))\b/;
const spokenNumber = /\b(?:zero|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dez[ea][a-z]+|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|[a-z]+cent[oa]s|mil|milhao|milhoes)\b/;
const affirms = /\b(?:sim|ok(?:ay)?|beleza|confirmo|confirmad[oa]|corret[oa]|cert[oa]|certinh[oa]|exat[oa]|exatamente|isso|ess[ae] mesm[oa]|e ess[ae]|confere|procede|perfeit[oa]|positivo|corresponde)\b/;
const states: readonly string[] = OAB_STATES;
const stateCode = new RegExp('\\b(' + states.join('|') + ')\\b', 'gi');
const noNumber = 'Preciso confirmar a inscrição da OAB com a equipe antes de informar o número.';

function fold(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
}

function words(text: string) {
  return fold(text).replace(/[^a-z]+/g, ' ').trim();
}

function hasNumber(text: string) {
  // A signing link, deadline or price in another line is not a registration.
  const candidate = fold(text).replace(/https?:\/\/[^\s]+/g, url => topic.test(url) ? url : '')
    .replace(/\b(?:telefone|whatsapp|celular|cpf|cnpj|cep)\s*(?:(?:e|eh|n[º°o]?)\s*)?[:=]?\s*\+?[\d(][\d().\s/-]*/g, '')
    .replace(/\br\$\s*[\d.,]+|\b\d+\s*(?:minutos?|horas?|dias?)\b|\b\d{1,2}[:h]\d{2}\b|\b\d{2}\/\d{2}\/\d{4}\b/g, '');
  return /\d/.test(candidate) || spokenNumber.test(candidate) || /^(?:um|uma)[.! ]*$|\b(?:numero|inscricao|registro) (?:e )?(?:um|uma)\b/.test(candidate);
}

const segmentText = (s: ReplySegment) => s.kind === 'text' ? s.text : s.caption ?? '';
function mentionsOab(text: string) {
  const normalized = fold(text).replace(/_/g, ' ');
  return topic.test(normalized) || /\b(?:inscrit[oa]|registrad[oa])\s+(?:(?:na ordem|na seccional)\s+)?sob\s+(?:o\s+)?(?:n(?:umero|[.º°o])?|registro)\b/.test(normalized)
    || /\b(?:advogad[oa]|dra?\.)[^\n]{0,80}\b(?:inscricao|registro|carteirinha)\s*(?:n[º°.]?|numero|:)/.test(normalized);
}

/** With an empty reply this can be used before generation to look up the tenant's records. */
export function needsOabCheck(segments: readonly ReplySegment[], lastInbound = '') {
  return mentionsOab(lastInbound) || segments.some(s =>
    mentionsOab(segmentText(s)) || (s.kind === 'media' && mentionsOab(s.name)));
}

// Explicit names win over an identical inscription belonging to a different lawyer.
// Treat an unfamiliar name after a title or "OAB da..." as an unknown professional.
const holderAnchor = /\b(?:(?:dr[a]?|doutor[a]?|advogad[oa])\.?\s+|(?:o\.?a\.?b|inscricao|registro)\s+(?:(?:d[ao]s?|de)\s+))/g;
const nameEnd = /^(?:e|tem|possui|atua|esta|inscrit[oa]|oab|uf|me|nos|aqui|atende|seria|pode|foi|numero|registro|inscricao|por|que|no|na|em|para|qual|corret[oa]|confirmad[oa]|obrigad[oa])$/;
const genericHolder = /^(?:advogad[oa]s?|doutor[a]?|dr[a]?|responsave[li]s?|escritorio|equipe|profissional|brasil|plantao|voces|voce|nosso|nossa|minha|meu|seu|sua|o|a)$/;

function holderRequests(text: string) {
  const normalized = fold(text);
  const requested: string[] = [];
  for (const match of text.matchAll(/\b([A-ZÀ-Ý][\p{L}'’-]*(?: [A-ZÀ-Ý][\p{L}'’-]*)*)\s+(?:tem|possui|está inscrit[oa])\s+(?:(?:uma?|a)\s+)?(?:O\.?A\.?B|inscri[çc][aã]o|registro)/gu)) {
    const name = words(match[1]);
    if (!genericHolder.test(name)) requested.push(name);
  }
  for (const anchor of normalized.matchAll(holderAnchor)) {
    const tail = normalized.slice(anchor.index! + anchor[0].length);
    const tokens = (/^[a-z' -]+/.exec(tail)?.[0] ?? '').trim().split(/\s+/);
    const parts: string[] = [];
    for (const token of tokens) {
      if (!token || nameEnd.test(token) || genericHolder.test(token) || states.includes(token.toUpperCase())) break;
      parts.push(token);
    }
    while (parts.length && /^(?:d[aeo]s?|de)$/.test(parts.at(-1)!)) parts.pop();
    if (parts.length) requested.push(words(parts.join(' ')));
  }
  return requested;
}

function namesMatch(full: string, requested: string) {
  const name = words(full).replace(/^(?:dra?|doutora?|advogad[oa]) /, '');
  return name === requested || name.startsWith(requested + ' ');
}

function named(text: string, entry: ConfirmedOabRegistration) {
  const name = words(entry.professionalName).replace(/^(?:dra?|doutora?|advogad[oa]) /, '');
  return name.length > 0 && (' ' + words(text) + ' ').includes(' ' + name + ' ');
}

function resolveRegistration(records: readonly ConfirmedOabRegistration[], inbound: string, reply: string) {
  let choices = records.filter(r => r.professionalName.trim() && states.includes(r.state) && /^\d{1,7}[A-Z]?$/.test(r.number));
  // First establish whom the customer asked about. A name invented by the model
  // must not silently substitute a different person when the request is ambiguous.
  for (const text of [inbound, reply]) {
    for (const request of holderRequests(text)) choices = choices.filter(r => namesMatch(r.professionalName, request));
    const explicit = records.filter(r => named(text, r));
    if (explicit.length) choices = choices.filter(r => explicit.includes(r));
    // A lower-case "se", "pr" etc. in ordinary prose is not a state abbreviation.
    const ufTokens = [...text.matchAll(stateCode)].filter(m =>
      m[0] === m[0].toUpperCase() || /(?:o\.?a\.?b\.?\s*[/:-]?\s*|[/–-]\s*)$/i.test(text.slice(0, m.index)));
    for (const match of ufTokens) choices = choices.filter(r => r.state === match[0].toUpperCase());
    if (text === inbound && mentionsOab(inbound) && choices.length > 1) return;
  }
  return choices.length === 1 ? choices[0] : undefined;
}

/** Never relay the draft's number. Render the verified holder, UF and number together. */
export function protectOabReply(segments: readonly ReplySegment[], registrations: readonly ConfirmedOabRegistration[], lastInbound = '') {
  const unchanged = { segments: [...segments], adjusted: false };
  if (!needsOabCheck(segments, lastInbound)) return unchanged;

  const inboundHasNumber = mentionsOab(lastInbound) && hasNumber(lastInbound);
  const risky = (line: string) => hasNumber(line) || (inboundHasNumber && affirms.test(fold(line)));
  const lines = segments.flatMap(s => segmentText(s).split(/\r?\n/));
  if (!lines.some(risky)) return unchanged;

  const entry = resolveRegistration(registrations, lastInbound, lines.join('\n'));
  const answer = entry ? `A inscrição confirmada de ${entry.professionalName} é OAB/${entry.state} ${entry.number}.` : noNumber;
  let rendered = false;
  const safe: ReplySegment[] = [];
  // Preserve independent instructions (including signing links) on the same line.
  const sentenceBreak = /(?<!\bDr\.)(?<!\bDra\.)(?<!\bO\.A\.B\.)(?<=[.!?;])[ \t]+/i;
  for (const segment of segments) {
    const text = segmentText(segment).split(/\r?\n/).map(line => line.split(sentenceBreak).flatMap(sentence => {
      if (!risky(sentence) && !mentionsOab(sentence)) return [sentence];
      if (rendered) return [];
      rendered = true;
      return [answer];
    }).join(' ')).filter(Boolean).join('\n').trim();
    if (segment.kind === 'media') safe.push({ ...segment, caption: text || undefined });
    else if (text) safe.push({ ...segment, text });
  }
  return { segments: safe, adjusted: true };
}
