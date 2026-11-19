import { internalOutputReason } from './replyOutput';

const quotedSaveExample = /["“]\[salvar_dados\][ \t]+(?:\{[ \t]*(?:\.\.\.|…)[ \t]*\}|…)["”]/gu;
const writingProhibition = /\b(?:não|nunca|jamais)\s+(?:(o|a|os|as)\s+)?(?:copie|escreva|repita|reproduza|envie|mostre|exiba|inclua)\b/iu;

/** Replace an example of forbidden text in instructions, never an action or a literal voice clip. */
function scriptInstructions(text: string): string {
  if (!text.includes('[salvar_dados]')) return text;
  return text.replace(/[^\r\n]+/gu, line => {
    const prohibition = writingProhibition.exec(line);
    if (!prohibition) return line;
    const prohibitionEnd = prohibition.index + prohibition[0].length;
    return line.replace(quotedSaveExample, (literal, offset: number) => {
      const before = line.slice(0, offset).trimEnd();
      if (before.length !== prohibitionEnd) {
        if (!/\b(?:como|exemplo)\s*[:,]?\s*$/iu.test(before)) return literal;
        // A later prohibition must refer back to the example. An unrelated
        // instruction such as “não envie o comprovante” does not qualify.
        const refersToExample = prohibitionEnd <= offset
          ? !/[.!?]/u.test(line.slice(prohibitionEnd, offset))
          : prohibition[1] || /^\s+(?:isso|isto|ess[ae]s?|est[ae]s?|o exemplo)\b/iu.test(line.slice(prohibitionEnd));
        if (!refersToExample) return literal;
      }
      return 'uma anotação de salvamento de dados com seus argumentos';
    });
  });
}

/** Markers belong to the saved script. Customer messages never define voice clips. */
export function readVoiceScript(script: string, textOnly = false, previousClips: readonly string[] = []) {
  const clips = [...previousClips];
  let start = -1;
  let cursor = 0;
  let prompt = '';
  let error = '';
  for (const match of script.matchAll(/\[(\/?)audio\]/gi)) {
    const i = match.index!;
    if (!match[1]) {
      if (start >= 0) { error = 'Feche o trecho de áudio antes de abrir outro.'; break; }
      prompt += scriptInstructions(script.slice(cursor, i));
      start = i + match[0].length;
      continue;
    }
    if (start < 0) { error = 'Há um fechamento [/audio] sem abertura [audio].'; break; }
    const text = script.slice(start, i).trim();
    if (!text || text.length > 3500) { error = 'Cada trecho de áudio precisa ter entre 1 e 3.500 caracteres.'; break; }
    if (/\{\{|\[\[/.test(text)) { error = 'Deixe variáveis e ações fora da fala literal do áudio.'; break; }
    if (internalOutputReason(text) || text.includes('[SEM_RESPOSTA]')) { error = 'Coloque apenas o que o agente deve falar, sem comandos internos.'; break; }
    if (/(?:https?:\/\/|www\.)/i.test(text)) { error = 'Coloque o link depois de [/audio] para ele seguir como texto clicável.'; break; }
    let index = clips.indexOf(text);
    if (index < 0) index = clips.push(text) - 1;
    prompt += textOnly ? text : '(Neste ponto chame falar_trecho com trecho ' + (index + 1) +
      ' para a fala ' + JSON.stringify(text) + '. O CRM envia a fala cadastrada. Não repita a fala em texto.)';
    start = -1;
    cursor = i + match[0].length;
  }
  if (!error && start >= 0) error = 'Feche o trecho de áudio com [/audio].';
  // A legacy invalid script must not duplicate or execute partially parsed instructions.
  return error ? { clips: [...previousClips], prompt: script, error } : { clips, prompt: prompt + scriptInstructions(script.slice(cursor)), error };
}

export function readAgentVoiceScripts(script: string, followup = '', textOnly = false) {
  const primary = readVoiceScript(script, textOnly);
  const rule = readVoiceScript(followup, textOnly, primary.clips);
  return { prompt: primary.prompt, followupPrompt: rule.prompt, clips: rule.clips };
}

export function wrapVoiceSelection(value: string, start: number, end: number) {
  const selection = value.slice(start, end);
  return { value: value.slice(0, start) + '[audio]' + selection + '[/audio]' + value.slice(end), start: start + 7, end: end + 7 };
}
