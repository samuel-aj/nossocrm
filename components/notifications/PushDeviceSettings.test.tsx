import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PushDeviceSettings } from './PushDeviceSettings';

const api = vi.hoisted(() => ({ readPushDevice: vi.fn(), enablePushDevice: vi.fn(), disablePushDevice: vi.fn(), pushSupport: vi.fn() }));
vi.mock('@/lib/notifications/pushDevice', () => api);
const scope = { userId: 'me', organizationId: 'office' };
beforeEach(() => {
  vi.resetAllMocks();
  api.pushSupport.mockReturnValue('ready');
  api.readPushDevice.mockResolvedValue({ enabled: false, publicKey: 'test-key' });
});
afterEach(cleanup);
it('waits for an explicit click and marks messages in the preference draft only on success', async () => {
  const enableMessages = vi.fn();
  render(<PushDeviceSettings scope={scope} messages={false} onEnableMessages={enableMessages}/>);
  const enable = await screen.findByRole('button', { name: 'Ativar neste aparelho' });
  await waitFor(() => expect(enable).toBeEnabled());
  expect(api.enablePushDevice).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(enable); });
  expect(await screen.findByRole('button', { name: 'Desativar neste aparelho' })).toBeEnabled();
  expect(api.enablePushDevice).toHaveBeenCalledWith(scope, 'test-key');
  expect(enableMessages).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/salve suas preferências/i)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Desativar neste aparelho' })); });
  expect(api.disablePushDevice).toHaveBeenCalledWith(scope);
});
it('shows a useful activation error and leaves the draft unchanged', async () => {
  api.enablePushDevice.mockRejectedValueOnce(new Error('Autorize o aparelho'));
  const enableMessages = vi.fn();
  render(<PushDeviceSettings scope={scope} messages={false} onEnableMessages={enableMessages}/>);
  const enable = screen.getByRole('button');
  await waitFor(() => expect(enable).toBeEnabled());
  await act(async () => { fireEvent.click(enable); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Autorize o aparelho');
  expect(enableMessages).not.toHaveBeenCalled();
});
it('shows iPhone installation guidance without calling the server', () => {
  api.pushSupport.mockReturnValue('install-ios');
  render(<PushDeviceSettings scope={scope} messages onEnableMessages={vi.fn()}/>);
  expect(screen.getByText(/Tela de Início/)).toBeInTheDocument();
  expect(api.readPushDevice).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
});
it('explains missing server configuration before requesting permission', async () => {
  api.readPushDevice.mockResolvedValue({ enabled: false, publicKey: null });
  render(<PushDeviceSettings scope={scope} messages onEnableMessages={vi.fn()}/>);
  expect(await screen.findByText(/configurado no servidor/)).toBeInTheDocument();
  expect(screen.getByRole('button')).toBeDisabled();
});
