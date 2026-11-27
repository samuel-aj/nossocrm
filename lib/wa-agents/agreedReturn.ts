import type { ModelMessage } from 'ai';
import type { CollectedToolCall } from './replyGeneration';
import type { ReplySegment } from './replyOutput';
import { normalizeKeyword } from './text';
import type { AgentToolRuntime } from './tools';

// Only a standalone request, or an explicit answer to an offer about a callback,
// can take this shortcut. Other conversations stay with the ordinary agent/tools.
const request = /^(?:por favor[, ]+)?(?:voce )?(?:pode(?:m)? (?:me chamar|me retornar|falar comigo|entrar em contato comigo)|me (?:chama|chame|chamem|retorna|retorne)|retorn[ae] comigo)\s+(.+)$/;
const reschedule = /^(?:(?:pode |quero )?(?:remarcar|reagendar|mudar|trocar)|(?:remarca|remarque|reagenda|reagende|muda|mude|troca|troque))(?: (?:o|meu|nosso) (?:retorno|horario))? (?:para|pra) (.+)$/;
const offer = /^(?:(?:combinado|certo|entendi)[,.! ]+)?(?:posso|podemos) (?:te chamar|chamar voce|te retornar|entrar em contato(?: com voce)?|voltar a falar com voce|(?:remarcar|reagendar|mudar|trocar) (?:o|seu|nosso) (?:retorno|horario) (?:para|pra))\s+(.+)$/;
const timeQuestion = /^(?:a que horas|que horas|qual (?:o )?(?:melhor )?horario) (?:posso|podemos|voce prefere que eu|para eu|pra eu) (?:te chamar|te retornar|entrar em contato(?: com voce)?|falar com voce)$/;
const yes = /^(?:sim|pode(?: sim)?|pode ser|combinado|isso(?: mesmo)?|ta (?:bom|certo)|tudo bem|ok|blz|beleza|fechado|👍(?:\p{Emoji_Modifier})?)$/u;

function messageText(message: ModelMessage | undefined) {
  return typeof message?.content === 'string' ? normalizeKeyword(message.content).replace(/[.!?,\s]+$/u, '') : '';
}

function acknowledged(message: ModelMessage | undefined) {
  if (typeof message?.content !== 'string' || message.content.includes('?')) return false;
  const words = messageText(message).replace(/[,! ]+(?:muito )?obrigad[oa]$/, '');
  return yes.test(words);
}

function timingFromRequest(messages: ModelMessage[]) {
  const last = messages.at(-1);
  if (last?.role !== 'user') return null;
  const latest = messageText(last);
  const previous = messages.at(-2);
  const question = previous?.role === 'assistant' ? messageText(previous) : '';
  const change = typeof last.content === 'string' && !last.content.includes('?') ? reschedule.exec(latest)?.[1] : undefined;
  return request.exec(latest)?.[1] ?? change ?? (acknowledged(last) ? offer.exec(question)?.[1] : timeQuestion.test(question) ? latest : null);
}

function agreedTime(messages: ModelMessage[]) {
  const timing = timingFromRequest(messages);
  if (!timing) return null;
  const when = timing.replace(/,? por favor$/, '').replace(/ de (hoje|amanha)$/, ' $1');
  // An expressly discussed time zone should be resolved by the ordinary tools.
  if (messages.slice(-6).some(m => /\b(?:fuso|horario (?:de|da|do|local))\b/.test(messageText(m)))) return null;
  const relative = /^(?:daqui a|daqui|em) (\d{1,3})\s*(h|horas?|min|minutos?)$/.exec(when);
  if (relative && Number(relative[1]) > 0) return { minutes: Number(relative[1]) * (relative[2].startsWith('h') ? 60 : 1) };
  // Resolve an explicit calendar date or weekday using the reservation's actual time zone.
  const named = /^(?:no dia |dia )?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)(?:,)?\s+as?\s+([01]?\d|2[0-3])(?:(?:h|:)([0-5]\d)?|\s+horas?)?$/.exec(when);
  if (named) return { day: named[1], hour: named[2].padStart(2, '0'), minute: named[3] ?? '00' };
  const clock = /^(?:(hoje|amanha)\s+)?(?:as?\s+)?([01]?\d|2[0-3])(?:(?:h|:)([0-5]\d)?|\s+horas?)?(?:\s+(hoje|amanha))?$/.exec(when);
  if (!clock || (clock[1] && clock[4])) return null;
  return { day: clock[1] || clock[4], hour: clock[2].padStart(2, '0'), minute: clock[3] ?? '00' };
}

export const RETURN_UNCONFIRMED = 'Não consegui confirmar o agendamento do seu retorno. Seu atendimento continua por aqui.';
const ASK_RETURN_TIME = 'Qual dia e horário ficam melhores para eu te chamar?';

/** Formatter that reads an instant as "YYYY-MM-DD HH:mm" on the wall clock of a time zone. */
function wallClock(timezone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * "hoje (25/11) às 15h", "amanhã (25/11) às 9h30", "dia 27/11 às 9h" or, in another year, "dia 05/01/2027 às 9h".
 * Today and tomorrow are counted in the reservation's time zone, which is never shown. They carry the date
 * because a line held while the number is offline can be delivered on another day.
 * `acknowledged` leaves out the opening "Combinado!" when the reply already says it.
 */
function sayScheduled(at: string, timezone: string, now: string, acknowledged = false) {
  const formatter = wallClock(timezone);
  const [date, time] = formatter.format(new Date(at)).split(' ');
  const today = formatter.format(new Date(now)).slice(0, 10);
  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');
  const daysAhead = (Date.parse(date) - Date.parse(today)) / 86_400_000;
  const dayText = daysAhead === 0 ? `hoje (${day}/${month})` : daysAhead === 1 ? `amanhã (${day}/${month})`
    : `dia ${day}/${month}${today.slice(0, 4) === year ? '' : '/' + year}`;
  // "à 0h" and "à 1h" are singular. Minutes appear only when they are not zero.
  const hourText = `${Number(hour) < 2 ? 'à' : 'às'} ${Number(hour)}h${minute === '00' ? '' : minute}`;
  return `${acknowledged ? '' : 'Combinado! '}Te chamo ${dayText} ${hourText}.`;
}

type ReturnService = NonNullable<AgentToolRuntime['scheduledReturn']>;
type ReturnInspection = {
  now: string;
  timezone: string;
  pending: { id: string; scheduled_for: string; scheduled_timezone: string } | null;
};

function localAgreement(agreement: NonNullable<ReturnType<typeof agreedTime>>, state: ReturnInspection, timezone: string) {
  const formatter = wallClock(timezone);
  const localNow = formatter.format(new Date(state.now)).replace(' ', 'T');
  if (agreement.minutes !== undefined) {
    return formatter.format(new Date(Date.parse(state.now) + agreement.minutes * 60_000)).replace(' ', 'T');
  }
  // "Remarque para as 20h" changes only the hour of the existing appointment.
  const base = !agreement.day && state.pending ? formatter.format(new Date(state.pending.scheduled_for)).slice(0, 10) : localNow.slice(0, 10);
  const date = new Date(base + 'T00:00:00Z');
  const day = agreement.day;
  if (day?.includes('/')) {
    const [dd, mm, yyyy] = day.split('/').map(Number);
    const year = date.getUTCFullYear();
    date.setUTCFullYear(yyyy ?? year, mm - 1, dd);
    if (!yyyy && date.toISOString().slice(0, 10) < localNow.slice(0, 10)) date.setUTCFullYear(year + 1, mm - 1, dd);
    if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return '';
  } else if (day === 'amanha') date.setUTCDate(date.getUTCDate() + 1);
  else if (day && day !== 'hoje') {
    const weekday = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].indexOf(day.split('-')[0]);
    date.setUTCDate(date.getUTCDate() + (weekday - date.getUTCDay() + 7) % 7);
  }
  return date.toISOString().slice(0, 10) + 'T' + agreement.hour + ':' + agreement.minute;
}

export function explicitlyEndsReturn(messages: ModelMessage[]) {
  const latest = messages.at(-1);
  if (latest?.role !== 'user' || typeof latest.content !== 'string' || latest.content.includes('?')) return false;
  const words = messageText(latest).replace(/^(?:por favor|obrigad[oa])[,! ]+/, '')
    .replace(/[,! ]+(?:por favor|(?:muito )?obrigad[oa]|valeu)$/, '');
  const previous = messages.at(-2);
  if (/^(?:sim|pode(?: sim)?|pode cancelar|pode desmarcar)$/.test(words) && previous?.role === 'assistant' &&
    /^(?:posso cancelar (?:o |seu )?retorno|ja resolveu (?:o|seu) (?:problema|caso) e posso cancelar o retorno)$/.test(messageText(previous))) return true;
  const cancel = /^(?:(?:pode |quero )?(?:cancelar|desmarcar)|(?:cancela|cancele|desmarca|desmarque)) (?:o |meu |nosso |esse |este )?(?:retorno|agendamento|horario)(?: combinado| agendado)?$/;
  const optOut = /^(?:nao (?:precisa|precisam) (?:mais )?(?:me (?:chamar|ligar|contatar|procurar)|retornar|entrar em contato(?: comigo)?)|nao (?:me (?:cham[ae]|ligue|procure)|entre em contato(?: comigo)?) mais|nao quero mais (?:contato|o retorno|ser contatad[oa]))$/;
  const resolved = /^(?:eu )?(?:ja )?(?:resolvi(?: tudo| (?:o|meu) (?:problema|caso|assunto))|esta tudo resolvido)$/;
  const [first, second, ...rest] = words.split(/[,!.]+\s*/);
  if (second === undefined) return cancel.test(first) || optOut.test(first) || resolved.test(first);
  return rest.length === 0 && (resolved.test(first) || /^(?:eu )?(?:ja )?resolvi$/.test(first)) && (cancel.test(second) || optOut.test(second));
}

/** A provider tool call is not proof of a new agreement. Use the original lead turn, even on subsequent SDK steps. */
export function returnServiceForModel(service: ReturnService, messages: ModelMessage[]): ReturnService {
  const latest = messages.at(-1);
  const preserve = 'Mantenha o horário combinado. Para alterar o retorno, confirme o novo dia e horário com o cliente.';
  return {
    inspect: service.inspect,
    cancel: async () => explicitlyEndsReturn(messages) ? service.cancel() :
      { ok: false, error: 'Mantenha o retorno. O cliente não pediu o cancelamento nem confirmou que resolveu a questão.' },
    schedule: async input => {
      if (latest?.role !== 'user' || explicitlyEndsReturn(messages)) return { ok: false, error: preserve };
      const state = await service.inspect() as ReturnInspection;
      if (!state || !('pending' in state)) throw new Error('Não foi possível consultar o retorno atual.');
      if (state.pending) {
        const agreement = agreedTime(messages);
        const timezone = state.pending.scheduled_timezone || state.timezone;
        if (!agreement || input.timezone !== timezone || localAgreement(agreement, state, timezone) !== input.local) {
          return { ok: false, preserved: true, pending: state.pending, error: preserve };
        }
      } else {
        // With no pending row (including a cancellation just applied on inbound),
        // don't turn a receipt, thank-you, or unrelated message into a fresh booking.
        const timing = timingFromRequest(messages);
        const words = messageText(latest);
        const asksForReturn = /\b(?:me (?:cham\w+|lig\w+|retorn\w+)|(?:pode[m]?|quero) (?:falar comigo|(?:agendar|marcar) (?:o |um )?retorno)|entrar em contato comigo|^(?:por favor[, ]+)?(?:ligue|liga|liguem|retorne|retorna|retornem))\b/.test(words);
        const proposed = timing ?? (asksForReturn ? words : '');
        if (!/\d|\b(?:meio[- ]dia|meia[- ]noite|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze) horas?\b/.test(proposed) ||
          /\b(?:nao|talvez|se der|se puder|tenho duvida|nao sei)\b/.test(proposed)) return { ok: false, error: preserve };
      }
      return service.schedule(input);
    },
  };
}

/** No model-generated date or promise is authority for a reservation. */
export async function bookExplicitReturn(messages: ModelMessage[], service: NonNullable<AgentToolRuntime['scheduledReturn']>) {
  const agreement = agreedTime(messages);
  if (!agreement) return null;
  const calls: CollectedToolCall[] = [];
  let tool = 'consultar_retorno';
  let input: object = {};
  try {
    const inspection = await service.inspect() as ReturnInspection;
    calls.push({ tool, input, output: inspection });
    const now = inspection.now;
    const timezone = inspection.pending?.scheduled_timezone || inspection.timezone;
    if (!timezone || !Number.isFinite(Date.parse(now))) throw new Error('Relógio de retorno indisponível');
    const local = localAgreement(agreement, inspection, timezone);
    if (local <= wallClock(timezone).format(new Date(now)).replace(' ', 'T')) return { text: ASK_RETURN_TIME, calls };
    const args = { local, timezone, context: 'Retorno solicitado pelo cliente: ' + messageText(messages.at(-1)), confirmed: true as const };
    tool = 'agendar_retorno';
    input = args;
    const result = await service.schedule(args) as { ok?: boolean; id?: string; scheduledAt?: string };
    calls.push({ tool, input, output: result });
    if (!result?.ok || !result.id || !result.scheduledAt) return { text: RETURN_UNCONFIRMED, calls };
    return { text: sayScheduled(result.scheduledAt, timezone, now), calls };
  } catch (error) {
    if (!calls.some(call => call.tool === tool)) calls.push({ tool, input, output: { ok: false, error: error instanceof Error ? error.message : 'Falha ao agendar retorno' } });
    return { text: RETURN_UNCONFIRMED, calls };
  }
}

function claimsReturn(sentence: string) {
  const s = normalizeKeyword(sentence);
  if (s.endsWith('?') || /\bnao (?:foi |esta |ficou |consegui |posso |vou )?(?:agend|marc|te cham|te retorn)|\bainda preciso confirmar\b/.test(s)) return false;
  if (/\b(?:retorno (?:esta |foi |ficou )?(?:agendado|marcado)|agendei (?:o |seu |nosso )?retorno)\b/.test(s)) return true;
  return /\b(?:(?:consigo|vou|vamos) (?:te |lhe )?(?:chamar|retornar|procurar)|(?:te |lhe )(?:chamo|chamarei|retorno)|vou entrar em contato|entraremos em contato|voltarei a falar com voce)\b/.test(s) &&
    /\b(?:hoje|amanha|depois|mais tarde|daqui|(?:as?|em) \d{1,2}|\d{1,2}(?:h(?:[0-5]\d)?|:\d{2})|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(s);
}

/** Use an actual reservation (including a previously inspected one), never a time invented by the model. `now` is the system clock outside tests. */
export function guardReturnPromises(segments: ReplySegment[], calls: CollectedToolCall[], available: boolean, messages: ModelMessage[] = [], now = new Date().toISOString()) {
  const timing = timingFromRequest(messages);
  const requested = !!timing && /\d|\b(?:hoje|amanha|semana|segunda|terca|quarta|quinta|sexta|sabado|domingo|tarde|noite|manha)\b/.test(timing);
  let changed = false;
  let acknowledged = false;
  const cleaned = segments.flatMap((segment): ReplySegment[] => {
    const content = segment.kind === 'text' ? segment.text : segment.caption;
    if (!content) return [segment];
    const sentences = content.split(/(?<=[.!?])\s+|\n+/u);
    const kept = sentences.filter(sentence => {
      if (claimsReturn(sentence)) return false;
      return !(requested && /^(?:combinado|marcado|agendado|pode deixar|ate la)(?:[.! ]*$| (?:para |as? |entao\b))/.test(normalizeKeyword(sentence)));
    });
    // A kept sentence that says "combinado" anywhere ("Tá combinado, <nome>!") already confirms it, so it is not said twice.
    if (kept.some(sentence => /\bcombinad/.test(normalizeKeyword(sentence)))) acknowledged = true;
    if (kept.length === sentences.length) return [segment];
    changed = true;
    if (segment.kind === 'media') return [{ ...segment, caption: kept.join(' ') || undefined }];
    return kept.length ? [{ kind: 'text', text: kept.join(' '), step: segment.step }] : [];
  });
  if (!changed) return null;
  const action = calls.findLast(c => ['agendar_retorno', 'consultar_retorno', 'cancelar_retorno'].includes(c.tool));
  const state = action?.output as { ok?: boolean; preserved?: boolean; id?: string; scheduledAt?: string; timezone?: string;
    pending?: { id?: string; scheduled_for?: string; scheduled_timezone?: string } } | undefined;
  const record = action?.tool === 'consultar_retorno' || (action?.tool === 'agendar_retorno' && state?.preserved) ? state?.pending : action?.tool === 'agendar_retorno' && state?.ok
    ? { id: state.id, scheduled_for: state.scheduledAt, scheduled_timezone: state.timezone } : null;
  let answer = available ? ASK_RETURN_TIME : 'Você pode me chamar por aqui no horário que preferir.';
  if (available && action?.tool === 'agendar_retorno') answer = RETURN_UNCONFIRMED;
  if (available && record?.id && record.scheduled_for && record.scheduled_timezone) {
    answer = sayScheduled(record.scheduled_for, record.scheduled_timezone, now, acknowledged);
  }
  return [...cleaned, { kind: 'text' as const, text: answer }];
}
