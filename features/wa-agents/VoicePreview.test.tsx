import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_MEDIA_UNDERSTANDING } from '@/lib/wa-agents/types';
import { VoicePreview } from './VoicePreview';
import { waAgentsFetch } from './useWaAgents';

vi.mock('./useWaAgents', () => ({ waAgentsFetch: vi.fn() }));

it('permite ouvir outra voz antes de salvar e repetir uma prévia que falhou', async () => {
  const fetch = vi.mocked(waAgentsFetch);
  fetch.mockResolvedValueOnce({ audio: 'AQI=' }).mockRejectedValueOnce(new Error('Falha temporária.')).mockResolvedValueOnce({ audio: 'AwQ=' });
  function sample(voice: 'alloy' | 'coral') {
    return <VoicePreview key={voice} agentId={null} draft={{
      name: '', media_understanding: { ...DEFAULT_AGENT_MEDIA_UNDERSTANDING, voice },
    }} />;
  }
  const { rerender } = render(sample('alloy'));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ouvir prévia' }));
  expect((await screen.findByLabelText('Prévia da voz selecionada')).getAttribute('src')).toBe('data:audio/mpeg;base64,AQI=');
  rerender(sample('coral'));
  expect(screen.queryByLabelText('Prévia da voz selecionada')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ouvir prévia' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Falha temporária.');
  fireEvent.click(screen.getByRole('button', { name: 'Ouvir prévia' }));
  expect((await screen.findByLabelText('Prévia da voz selecionada')).getAttribute('src')).toBe('data:audio/mpeg;base64,AwQ=');
  expect(fetch).toHaveBeenLastCalledWith('/api/wa-agents/agents/new/test', expect.objectContaining({
    body: expect.objectContaining({ previewVoice: true, draft: expect.objectContaining({ media_understanding: expect.objectContaining({ voice: 'coral' }) }) }),
  }));
});
