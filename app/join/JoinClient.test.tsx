import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JoinClient } from './JoinClient';

const m = vi.hoisted(() => ({
  getUser: vi.fn(), setSession: vi.fn(), signInWithPassword: vi.fn(), signInWithOtp: vi.fn(),
  push: vi.fn(), replace: vi.fn(), accept: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => m, useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: m } }));
const email = 'member@example.invalid';
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/join?token=fixture');
  m.getUser.mockResolvedValue({ data: { user: { email } } }); m.setSession.mockResolvedValue({ error: null });
  m.signInWithPassword.mockResolvedValue({ error: null }); m.signInWithOtp.mockResolvedValue({ error: null });
  m.accept.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('validate')
    ? Promise.resolve(Response.json({ valid: true, invite: { email } })) : m.accept()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fill() {
  fireEvent.change(await screen.findByLabelText('Nome Completo'), { target: { value: 'Pessoa' } });
  for (const label of ['Crie sua senha', 'Confirme sua senha']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'test-only-9!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar Minha Conta' }));
}
it('importa a sessão do link nominal antes de enviar o aceite e remove os tokens da URL', async () => {
  window.history.replaceState(null, '', '/join?token=fixture#type=invite&access_token=test-access&refresh_token=test-refresh');
  render(<JoinClient token="fixture" />); await fill();
  await waitFor(() => expect(m.replace).toHaveBeenCalledWith('/select-org'));
  expect(m.setSession).toHaveBeenCalledWith({ access_token: 'test-access', refresh_token: 'test-refresh' });
  expect(window.location.hash).toBe('');
  expect(m.signInWithPassword).toHaveBeenCalledWith({ email, password: 'test-only-9!' });
});
it('não instala uma sessão de outro e-mail', async () => {
  window.history.replaceState(null, '', '/join?token=fixture#type=invite&access_token=test-access&refresh_token=test-refresh');
  m.getUser.mockResolvedValue({ data: { user: { email: 'other@example.invalid' } } });
  render(<JoinClient token="fixture" />);
  await screen.findByText('Convite indisponível');
  expect(m.setSession).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it('oferece reconfirmação na mesma caixa de e-mail sem criar outra conta', async () => {
  m.accept.mockResolvedValue(Response.json({ code: 'confirm_email', error: 'Confirme seu e-mail.' }, { status: 403 }));
  render(<JoinClient token="fixture" />); await fill();
  fireEvent.click(await screen.findByRole('button', { name: 'Enviar novo link de confirmação' }));
  await screen.findByText(/Enviamos um link/);
  expect(m.signInWithOtp).toHaveBeenCalledWith({ email, options: { shouldCreateUser: false, emailRedirectTo: expect.stringContaining('/join?token=fixture') } });
  expect(m.signInWithPassword).not.toHaveBeenCalled();
});
