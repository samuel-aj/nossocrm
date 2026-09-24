import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const upload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: upload }) } },
}));
import { TemplateMediaUpload } from './TemplateMediaUpload';

it('does not apply a late upload completion after switching away from its connection', async () => {
  let finishUpload!: (result: { error: null }) => void;
  upload.mockReturnValue(new Promise(resolve => { finishUpload = resolve; }));
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ mediaId: 'old-asset', path: 'old-path', token: 'signed' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ mediaId: 'old-asset', previewUrl: 'https://storage.test/old' }) });
  vi.stubGlobal('fetch', fetcher);
  const onUploaded = vi.fn();
  const onBusy = vi.fn();
  const { unmount } = render(<TemplateMediaUpload type="image" connectionId="old-connection" onUploaded={onUploaded} onBusy={onBusy} />);
  fireEvent.change(screen.getByLabelText('Arquivo do modelo'), { target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] } });
  await waitFor(() => expect(upload).toHaveBeenCalled());
  expect(onBusy).toHaveBeenCalledWith(true);
  unmount();
  await act(async () => { finishUpload({ error: null }); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onUploaded).not.toHaveBeenCalled();
  expect(onBusy).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
