import { useCallback, useEffect, useRef, useState } from 'react';
import { isMetaFriendlyAudio, transcodeToMp3 } from '@/features/whatsapp/audioTranscode';
import { FEEDBACK_LIMITS } from '@/lib/feedback/constants';

/** Grava até 3 minutos. O Chrome grava webm, que a IA não lê: converte para MP3 como o chat do WhatsApp. */
export function useAudioRecorder(onDone: (audio: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      let blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
      if (!isMetaFriendlyAudio(blob.type)) blob = await transcodeToMp3(blob);
      onDone(blob);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => setSeconds(s => {
      if (s + 1 >= FEEDBACK_LIMITS.audioSeconds) stop();
      return s + 1;
    }), 1000);
  }, [onDone, stop]);

  useEffect(() => () => stop(), [stop]);
  return { recording, seconds, start, stop };
}
