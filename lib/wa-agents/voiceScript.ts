import { internalOutputReason } from './replyOutput';

/** Markers belong to the saved script. Customer messages never define voice clips. */
export function readVoiceScript(script: string, textOnly = false) {
  const clips: string[] = [];
  let start = -1;
  let cursor = 0;
  let prompt = '';
  let error = '';
  for (const match of script.matchAll(/\[(\/?)audio\]/gi)) {
    const i = match.index!;
    if (!match[1]) {
      if (start >= 0) { error = 'Feche o trecho de áudio antes de abrir outro.'; break; }
      prompt += script.slice(cursor, i);
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
  return error ? { clips: [], prompt: script, error } : { clips, prompt: prompt + script.slice(cursor), error };
}

export function wrapVoiceSelection(value: string, start: number, end: number) {
  const selection = value.slice(start, end);
  return { value: value.slice(0, start) + '[audio]' + selection + '[/audio]' + value.slice(end), start: start + 7, end: end + 7 };
}
