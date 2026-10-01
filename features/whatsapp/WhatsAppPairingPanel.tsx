'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { Copy, Loader2, QrCode, Smartphone } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import type { QrResult } from '@/lib/whatsapp/providers/types';

const names = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const countries = getCountries().map(value => ({ value, label: names.of(value) || value }))
  .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

async function requestPairing(url: string, init: RequestInit = {}): Promise<QrResult> {
  const response = await fetch(url, {
    credentials: 'include', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, ...init,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível conectar. Tente novamente.');
  return data;
}

export function WhatsAppPairingPanel({ connectionId, onClose, onConnected }: {
  connectionId: string; onClose: () => void; onConnected: () => void;
}) {
  const [method, setMethod] = useState<'qr' | 'code'>('qr');
  const [country, setCountry] = useState<CountryCode>('BR');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<QrResult | null>(null);
  const [pending, setPending] = useState(false);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const connectedCallback = useRef(onConnected);
  connectedCallback.current = onConnected;
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  // Codes stay in this mounted panel, outside the shared/persisted query cache.
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const current = generation.current;
    const poll = async () => {
      try {
        const next = await requestPairing(`/api/whatsapp/connection/pair?id=${encodeURIComponent(connectionId)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (stopped || current !== generation.current) return;
        if (next.state === 'connected') { setWatching(false); setResult(null); connectedCallback.current(); return; }
        if (next.state === 'disconnected') {
          setWatching(false); setResult(null); setError('Esta tentativa expirou. Gere um novo QR Code ou código.'); return;
        }
        setResult(next); setCopied(false);
        timer = setTimeout(poll, 4000);
      } catch (e) {
        if (stopped || current !== generation.current) return;
        setWatching(false); setResult(null);
        setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'A conexão demorou a responder. Tente novamente.');
      }
    };
    timer = setTimeout(poll, 4000);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [watching, connectionId]);

  const resetDisplay = () => {
    generation.current++; setWatching(false); setResult(null); setError(''); setCopied(false);
  };
  const generate = async () => {
    if (pending) return;
    const parsed = method === 'code' ? parsePhoneNumberFromString(phone, country) : undefined;
    if (method === 'code' && (!/^[+\d\s()-]+$/.test(phone.trim()) || !parsed?.isValid())) {
      setError('Confira o país e informe um telefone válido com DDD.'); return;
    }
    resetDisplay();
    const current = generation.current;
    setPending(true);
    try {
      const next = await requestPairing('/api/whatsapp/connection/pair', {
        method: 'POST', signal: AbortSignal.timeout(55000),
        body: JSON.stringify({ id: connectionId, method, ...(parsed ? { phone: parsed.number } : {}) }),
      });
      if (!mounted.current || current !== generation.current) return;
      if (next.state === 'connected') { connectedCallback.current(); return; }
      setResult(next); setWatching(true);
    } catch (e) {
      if (mounted.current && current === generation.current) setError(e instanceof Error && e.name !== 'TimeoutError'
        ? e.message : 'A conexão demorou a responder. Tente novamente.');
    } finally { if (mounted.current && current === generation.current) setPending(false); }
  };

  const code = result?.pairingCode;
  return (
    <section className="w-full min-w-0 space-y-5" aria-label="Conectar WhatsApp">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Método de conexão">
        {(['qr', 'code'] as const).map(value => (
          <button key={value} type="button" disabled={pending} aria-pressed={method === value}
            onClick={() => { if (value !== method) { resetDisplay(); setMethod(value); } }}
            className={`${button} border ${method === value ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300'}`}>
            {value === 'qr' ? <QrCode size={16} /> : <Smartphone size={16} />}
            {value === 'qr' ? 'QR Code' : 'Conectar por código'}
          </button>
        ))}
      </div>
      {method === 'code' && (
        <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void generate(); }}>
          <div>
            <label htmlFor={`${id}-country`} className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">País</label>
            <NativeSelect id={`${id}-country`} value={country} disabled={pending} searchable
              onChange={event => { resetDisplay(); setCountry(event.target.value as CountryCode); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-slate-900">
              {countries.map(c => <option key={c.value} value={c.value}>{c.label} (+{getCountryCallingCode(c.value)})</option>)}
            </NativeSelect>
          </div>
          <div>
            <label htmlFor={`${id}-phone`} className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Número do WhatsApp</label>
            <input id={`${id}-phone`} type="tel" autoComplete="tel-national" value={phone} disabled={pending}
              placeholder={country === 'BR' ? '(11) 99999-9999' : 'Telefone com código de área'}
              aria-describedby={`${id}-phone-help`} onChange={event => { resetDisplay(); setPhone(event.target.value); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white" />
            <p id={`${id}-phone-help`} className="mt-1 text-xs text-slate-500">Use o número do celular que deseja conectar, com DDD.</p>
          </div>
          <button type="submit" disabled={pending || !phone.trim()} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {pending && <Loader2 size={16} className="animate-spin" />}{pending ? 'Gerando código…' : code ? 'Gerar novo código' : 'Gerar código'}
          </button>
        </form>
      )}
      {method === 'qr' && (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-[232px] w-[232px] max-w-full shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white p-3">
            {result?.qrBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element -- Ephemeral data URI from the provider.
              <img src={result.qrBase64} alt="QR Code para conectar o WhatsApp" width={208} height={208} className="grayscale contrast-[500%]" />
            ) : pending ? <Loader2 size={28} className="animate-spin text-emerald-600" /> : <QrCode size={72} className="text-slate-300" />}
          </div>
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-white">Escaneie com o WhatsApp no celular</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Abra Configurações ou o menu ⋮ do WhatsApp.</li>
              <li>Entre em <strong>Aparelhos conectados → Conectar um aparelho</strong>.</li>
              <li>Aponte a câmera para o QR Code.</li>
            </ol>
            <button type="button" disabled={pending} onClick={() => void generate()} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
              {pending && <Loader2 size={16} className="animate-spin" />}{pending ? 'Gerando QR…' : result?.qrBase64 ? 'Gerar novo QR Code' : 'Gerar QR Code'}
            </button>
          </div>
        </div>
      )}
      {method === 'code' && code && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950/30">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Digite este código no WhatsApp do celular</p>
          <div className="flex flex-wrap items-center gap-3">
            <output aria-label="Código de pareamento" className="select-all font-mono text-2xl font-bold tracking-[0.15em] text-slate-900 dark:text-white">{code.slice(0, 4)}-{code.slice(4)}</output>
            <button type="button" className={`${button} border border-emerald-300 text-emerald-800 dark:text-emerald-200`}
              onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setError('Não foi possível copiar. Selecione o código e copie manualmente.'); } }}>
              <Copy size={15} />{copied ? 'Copiado!' : 'Copiar código'}
            </button>
          </div>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <li>Abra <strong>Aparelhos conectados → Conectar um aparelho</strong>.</li>
            <li>Toque em <strong>Conectar com número de telefone</strong>.</li>
            <li>Digite o código acima para confirmar.</li>
          </ol>
          <p className="text-xs text-slate-500 dark:text-slate-400">Use o código mais recente. Se ele for recusado, gere um novo código.</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{watching ? 'Aguardando confirmação no celular… A conexão será reconhecida automaticamente.' : 'Escolha como conectar este número.'}</p>
        <button type="button" disabled={pending} onClick={onClose} className="text-xs font-semibold text-slate-500 hover:underline disabled:opacity-50">Fechar</button>
      </div>
    </section>
  );
}
