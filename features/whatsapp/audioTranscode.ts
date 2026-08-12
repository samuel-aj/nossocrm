/**
 * Conversão de áudio no NAVEGADOR pra um formato que a Meta Cloud API aceita.
 *
 * Por quê: a Meta só aceita ogg/opus, mp4/AAC, mpeg (mp3), aac e amr. O
 * MediaRecorder do Chrome grava opus em webm OU em mp4 (\"audio/mp4;codecs=opus\")
 * — os dois são RECUSADOS no processamento da Meta (131053). Firefox grava
 * ogg/opus (aceito) e Safari grava mp4/AAC (aceito); só o Chrome/Edge precisa
 * converter. Converto pra MP3 (audio/mpeg): decodifica o blob com o próprio
 * navegador e re-encoda com o LAME em WASM (carregado sob demanda, ~150KB).
 */

/** true quando a gravação já sai num formato que a Meta aceita como está. */
export function isMetaFriendlyAudio(mime: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m.includes('ogg')) return true; // ogg/opus (Firefox) — vira mensagem de voz
  if (m.includes('mpeg') || m.includes('mp3')) return true;
  if (m.includes('aac')) return true;
  if (m.includes('amr')) return true;
  // mp4 só vale com AAC; o Chrome grava mp4 com OPUS (recusado pela Meta)
  if (m.includes('mp4') && !m.includes('opus')) return true;
  return false;
}

/** Converte um blob de áudio (webm/mp4/qualquer coisa que o browser toque) pra MP3 mono. */
export async function transcodeToMp3(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decodifica com o decodificador do navegador (Chrome decodifica webm/mp4-opus).
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }

  // Voz: mono basta (metade do tamanho e a Meta/celular tocam igual).
  const channels = decoded.numberOfChannels;
  const length = decoded.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  // LAME em WASM, carregado só quando precisa (não pesa o bundle do chat).
  const { createMp3Encoder } = await import('wasm-media-encoders');
  const encoder = await createMp3Encoder();
  encoder.configure({ channels: 1, sampleRate: decoded.sampleRate, vbrQuality: 5 });

  const parts: Uint8Array[] = [];
  // O buffer retornado é REUSADO pelo encoder — copiar (slice) antes de guardar.
  const CHUNK = 128 * 1024;
  for (let off = 0; off < mono.length; off += CHUNK) {
    const out = encoder.encode([mono.subarray(off, Math.min(off + CHUNK, mono.length))]);
    if (out.length > 0) parts.push(out.slice());
  }
  const tail = encoder.finalize();
  if (tail.length > 0) parts.push(tail.slice());

  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}
