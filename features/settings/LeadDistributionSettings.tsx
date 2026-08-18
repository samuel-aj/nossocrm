'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Scale, Shuffle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { UserRole } from '@/types/constants';

/**
 * Distribuição automática de leads: quem participa do rodízio, com que fatia
 * e em quais boards. Quem aplica a regra é o banco (trigger em deals), então
 * aqui só existe configuração + o retrato de quanto cada um recebeu.
 */

interface Participante {
  userId: string;
  name: string;
  role: string;
  weight: number;
  active: boolean;
  leadsToday: number;
  /** Recebidos na janela que o rodízio usa pra decidir (desde a última mudança). */
  leadsPeriodo: number;
}
interface BoardLite {
  id: string;
  name: string;
}
interface ApiData {
  isAdmin: boolean;
  enabled: boolean;
  manual: boolean;
  since: string | null;
  participants: Participante[];
  boards: BoardLite[];
  matrixOff: string[];
}

const iniciais = (nome: string) =>
  nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase() || '?';

const RING = 2 * Math.PI * 20; // r=20

export const LeadDistributionSettings: React.FC = () => {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const isAdmin = profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [data, setData] = useState<ApiData | null>(null);

  // estado editável
  const [enabled, setEnabled] = useState(false);
  const [manual, setManual] = useState(false);
  const [pesos, setPesos] = useState<Record<string, number>>({});
  const [ativos, setAtivos] = useState<Record<string, boolean>>({});
  const [matrixOff, setMatrixOff] = useState<Set<string>>(new Set());
  // quem o usuário já ajustou nesta sessão fica "travado" no rebalanceamento
  const travados = useRef<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch('/api/settings/lead-distribution', { credentials: 'include' });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const d = json as ApiData;
      setData(d);
      setEnabled(d.enabled);
      setManual(d.manual);
      setPesos(Object.fromEntries(d.participants.map(p => [p.userId, p.weight])));
      setAtivos(Object.fromEntries(d.participants.map(p => [p.userId, p.active])));
      setMatrixOff(new Set(d.matrixOff));
      travados.current = new Set();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const participantes = data?.participants ?? [];
  const idsAtivos = useMemo(
    () => participantes.filter(p => ativos[p.userId]).map(p => p.userId),
    [participantes, ativos]
  );

  /** Mantém a soma dos ativos em 100%, absorvendo a diferença em quem não foi
   *  ajustado à mão (mesma mecânica do painel que inspirou a tela). */
  const ajustarPeso = (userId: string, valor: number) => {
    const val = Math.max(0, Math.min(100, Math.round(valor)));
    travados.current.add(userId);
    const outros = idsAtivos.filter(id => id !== userId);
    if (!outros.length) {
      setPesos(p => ({ ...p, [userId]: 100 }));
      return;
    }
    setPesos(prev => {
      const next = { ...prev, [userId]: val };
      let livres = outros.filter(id => !travados.current.has(id));
      const fixos = outros.filter(id => travados.current.has(id));
      let alvo = 100 - val - fixos.reduce((s, id) => s + (next[id] || 0), 0);
      if (!livres.length || alvo < 0) {
        livres = outros;
        alvo = Math.max(0, 100 - val);
      }
      const somaLivres = livres.reduce((s, id) => s + (next[id] || 0), 0);
      livres.forEach(id => {
        next[id] = somaLivres > 0 ? ((next[id] || 0) / somaLivres) * alvo : alvo / livres.length;
      });
      return next;
    });
  };

  const alternarAtivo = (userId: string, on: boolean) => {
    travados.current.delete(userId);
    setAtivos(prev => ({ ...prev, [userId]: on }));
    setPesos(prev => {
      const next = { ...prev };
      const ativosDepois = participantes
        .map(p => p.userId)
        .filter(id => (id === userId ? on : ativos[id]));
      if (!ativosDepois.length) return next;
      if (on && !(next[userId] > 0)) next[userId] = 0;
      const soma = ativosDepois.reduce((s, id) => s + (next[id] || 0), 0);
      if (soma <= 0) ativosDepois.forEach(id => { next[id] = 100 / ativosDepois.length; });
      else ativosDepois.forEach(id => { next[id] = ((next[id] || 0) / soma) * 100; });
      return next;
    });
  };

  const dividirIgual = () => {
    if (!idsAtivos.length) {
      addToast('Ative pelo menos uma pessoa para dividir.', 'error');
      return;
    }
    travados.current = new Set();
    setPesos(prev => {
      const next = { ...prev };
      idsAtivos.forEach(id => { next[id] = 100 / idsAtivos.length; });
      return next;
    });
  };

  const alternarBoard = (userId: string, boardId: string, on: boolean) => {
    const k = `${userId}_${boardId}`;
    setMatrixOff(prev => {
      const next = new Set(prev);
      if (on) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const salvar = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/lead-distribution', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enabled,
          manual,
          participants: participantes.map(p => ({
            userId: p.userId,
            weight: Math.round((pesos[p.userId] || 0) * 1000) / 1000,
            active: Boolean(ativos[p.userId]),
          })),
          matrixOff: [...matrixOff],
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      addToast('Distribuição salva. Já vale para o próximo lead.', 'success');
      await carregar();
    } catch (e) {
      addToast('Erro ao salvar: ' + (e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const semNinguem = enabled && !participantes.some(p => ativos[p.userId] && (pesos[p.userId] || 0) > 0);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 py-16 justify-center">
        <Loader2 size={16} className="animate-spin" /> Carregando distribuição...
      </div>
    );
  }
  if (erro) {
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/10 p-5 text-sm text-red-600 dark:text-red-400">
        Não foi possível carregar: {erro}
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
          Distribuição de leads
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
          Defina quem recebe os leads novos e em que proporção. Vale para todo lead que chegar sem responsável.
        </p>
      </div>

      {/* Interruptores da organização */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6 mb-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Shuffle size={18} className="text-primary-500" /> Distribuir automaticamente
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              Leads que entram por integração (API pública, n8n, formulários do site) ganham um responsável na hora, seguindo as fatias abaixo.
            </p>
            {!isAdmin && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                Apenas administradores podem alterar essa configuração.
              </p>
            )}
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              disabled={!isAdmin}
              className="sr-only peer"
              aria-label="Ativar distribuição automática"
            />
            <div className="w-11 h-6 bg-slate-300 dark:bg-slate-600 rounded-full peer peer-focus:ring-4 peer-focus:ring-primary-500/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Incluir os leads criados dentro do CRM sem responsável
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              Vale para o lead que nasce de uma conversa no WhatsApp, por exemplo. Lead criado no Kanban continua com quem criou, sempre.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={manual}
              onChange={e => setManual(e.target.checked)}
              disabled={!isAdmin || !enabled}
              className="sr-only peer"
              aria-label="Distribuir também leads criados no CRM"
            />
            <div className="w-11 h-6 bg-slate-300 dark:bg-slate-600 rounded-full peer peer-focus:ring-4 peer-focus:ring-primary-500/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 peer-disabled:opacity-40" />
          </label>
        </div>
      </div>

      {semNinguem && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/10 px-5 py-4 mb-6">
          <AlertTriangle size={18} className="text-amber-500 shrink-0" />
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            A distribuição está ligada, mas ninguém está ativo com fatia maior que zero. Os leads vão continuar chegando sem responsável.
          </p>
        </div>
      )}

      {/* Pessoas e fatias */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Quem recebe</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              O próximo lead vai para quem estiver mais atrás da própria fatia
              {data?.since
                ? `, contando desde ${new Date(data.since).toLocaleDateString('pt-BR')} (última mudança).`
                : '.'}
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={dividirIgual}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <Scale size={15} /> Dividir igualmente
            </button>
          )}
        </div>

        {participantes.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic py-6 text-center">
            Nenhum membro na organização ainda. Convide a equipe em Configurações → Equipe.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {participantes.map(p => {
              const on = Boolean(ativos[p.userId]);
              const pct = on ? Math.round(pesos[p.userId] || 0) : 0;
              return (
                <div
                  key={p.userId}
                  className={`rounded-xl border p-4 transition-opacity ${
                    on
                      ? 'border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.03]'
                      : 'border-slate-200 dark:border-white/10 bg-slate-50/30 dark:bg-white/[0.01] opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="relative w-11 h-11 shrink-0">
                      <svg viewBox="0 0 46 46" className="w-11 h-11 -rotate-90">
                        <circle cx="23" cy="23" r="20" fill="none" strokeWidth="3" className="stroke-slate-200 dark:stroke-white/10" />
                        <circle
                          cx="23"
                          cy="23"
                          r="20"
                          fill="none"
                          strokeWidth="3"
                          strokeLinecap="round"
                          className="stroke-primary-500 transition-all"
                          strokeDasharray={RING}
                          strokeDashoffset={RING * (1 - pct / 100)}
                        />
                      </svg>
                      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        {iniciais(p.name)}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">
                        {p.role === UserRole.ADMIN ? 'Admin' : p.role === UserRole.SUPER_ADMIN ? 'Super admin' : 'Vendedor'}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={e => alternarAtivo(p.userId, e.target.checked)}
                        disabled={!isAdmin}
                        className="sr-only peer"
                        aria-label={`Incluir ${p.name} na distribuição`}
                      />
                      <div className="w-9 h-5 bg-slate-300 dark:bg-slate-600 rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500" />
                    </label>
                  </div>

                  <div className="flex items-center gap-3 mt-4">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={pct}
                      disabled={!on || !isAdmin}
                      onChange={e => ajustarPeso(p.userId, Number(e.target.value))}
                      aria-label={`Fatia de ${p.name}`}
                      className="flex-1 accent-primary-500 disabled:opacity-40"
                    />
                    <span className="text-xl font-bold text-slate-900 dark:text-white tabular-nums w-14 text-right">
                      {pct}%
                    </span>
                  </div>

                  <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-slate-100 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400">
                    <span>Recebidos hoje</span>
                    <span className="tabular-nums">
                      <b className="text-sm text-slate-900 dark:text-white">{p.leadsToday}</b>
                      <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                      {p.leadsPeriodo} no período
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Matriz por board */}
      {participantes.length > 0 && (data?.boards.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">Por pipeline</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            Desmarque para tirar alguém dos leads de um pipeline específico. Tudo marcado = recebe de todos.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-white/5">
                  <th className="text-left font-bold text-[10px] uppercase tracking-wider text-slate-400 px-4 py-3">
                    Pipeline
                  </th>
                  {participantes.map(p => (
                    <th
                      key={p.userId}
                      className="text-center font-bold text-[10px] uppercase tracking-wider text-slate-400 px-4 py-3 whitespace-nowrap"
                    >
                      {p.name.split(/\s+/)[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.boards ?? []).map(b => (
                  <tr key={b.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200 whitespace-nowrap">{b.name}</td>
                    {participantes.map(p => {
                      const on = ativos[p.userId] && !matrixOff.has(`${p.userId}_${b.id}`);
                      return (
                        <td key={p.userId} className="px-4 py-2.5 text-center">
                          <label className="relative inline-flex items-center cursor-pointer align-middle">
                            <input
                              type="checkbox"
                              checked={Boolean(on)}
                              disabled={!isAdmin || !ativos[p.userId]}
                              onChange={e => alternarBoard(p.userId, b.id, e.target.checked)}
                              className="sr-only peer"
                              aria-label={`${p.name} recebe leads de ${b.name}`}
                            />
                            <div className="w-8 h-[18px] bg-slate-300 dark:bg-slate-600 rounded-full peer peer-checked:after:translate-x-3.5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-500 peer-disabled:opacity-30" />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-60 transition-colors shadow-lg shadow-primary-600/20"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Salvar distribuição
          </button>
          <span className="text-sm text-slate-500 dark:text-slate-400">vale imediatamente para o próximo lead</span>
        </div>
      )}
    </div>
  );
};

export default LeadDistributionSettings;
