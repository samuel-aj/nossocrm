'use client';

import { useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import type { AgentInput } from '@/lib/wa-agents/types';
import { waAgentsFetch } from './useWaAgents';
import { BTN_SMALL, errorMessage } from './ui';

type Props = {
  agentId: string | null;
  text: string;
  draft?: Partial<AgentInput>;
};

export function VoicePreview({ agentId, text, draft }: Props) {
  const [audio, setAudio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function listen() {
    setBusy(true);
    setError('');
    try {
      const result = await waAgentsFetch<{ audio: string }>(`/api/wa-agents/agents/${agentId ?? 'new'}/test`, {
        method: 'POST',
        body: {
          previewVoice: text,
          draft: {
            provider: draft?.provider,
            api_key: draft?.api_key,
            audio_api_key: draft?.audio_api_key,
            media_understanding: draft?.media_understanding,
          },
        },
      });
      setAudio('data:audio/mpeg;base64,' + result.audio);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível gerar a prévia da voz.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {audio ? (
        <audio controls autoPlay className="max-w-full" src={audio} aria-label="Prévia da voz selecionada" />
      ) : (
        <button className={BTN_SMALL} type="button" disabled={busy} onClick={() => void listen()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
          {busy ? 'Gerando áudio…' : 'Ouvir prévia'}
        </button>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
