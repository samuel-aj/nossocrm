import React, { useMemo, useRef, useState } from 'react';
import { ServerCog, Copy, CheckCircle2, Play, AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';
import { useOptionalToast } from '@/context/ToastContext';
import { createOrganizationApiKey } from '@/lib/apiKeys/client';
import type { ApiKeyAccessMode } from '@/lib/apiKeys/accessModes';
import { ApiKeyAccessField } from './ApiKeyAccessField';
import { SettingsSection } from './SettingsSection';

/**
 * Seção de configurações para MCP (Model Context Protocol).
 * Expõe o CRM como MCP Server via `/api/mcp`.
 */
export const McpSection: React.FC = () => {
  const { addToast } = useOptionalToast();

  const endpointPath = '/api/mcp';
  const protocolVersion = '2025-11-25';

  const [apiKey, setApiKey] = useState('');
  const [accessMode, setAccessMode] = useState<ApiKeyAccessMode>('full');
  const [creatingKey, setCreatingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    toolsCount?: number;
    toolsPreview?: string[];
    testedAtIso?: string;
  } | null>(null);
  const [showHaveKey, setShowHaveKey] = useState(false);

  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);

  const origin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);
  const fullEndpoint = useMemo(() => (origin ? `${origin}${endpointPath}` : endpointPath), [origin]);
  const copyUrlAndToken = async () => {
    const token = apiKey.trim();
    if (!token) {
      addToast('Sem token. Clique em Conectar para gerar.', 'warning');
      return;
    }
    await copy('URL + Token', `URL\n${fullEndpoint}\n\nTOKEN\n${token}`);
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast(`${label} copiado.`, 'success');
    } catch {
      addToast(`Não foi possível copiar ${label.toLowerCase()}.`, 'error');
    }
  };

  const createApiKeyInline = async (): Promise<string | null> => {
    setCreatingKey(true);
    try {
      const name = `MCP ${new Date().toLocaleDateString('pt-BR')}`;
      const { token } = await createOrganizationApiKey(name, accessMode);

      setApiKey(token);
      setTestResult(null);
      addToast('API key criada e preenchida. (Ela aparece só uma vez.)', 'success');

      // UX: leva o foco pro campo do Passo 2.
      setTimeout(() => apiKeyInputRef.current?.focus(), 0);
      return token;
    } catch (e: any) {
      addToast(e?.message || 'Erro ao criar chave', 'error');
      return null;
    } finally {
      setCreatingKey(false);
    }
  };

  const navigateToApiKeys = () => {
    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.hash = '#api';
        window.history.replaceState({}, '', url.toString());
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    } catch {
      // best-effort
    }
  };

  const parseJsonSafe = async (res: Response) => {
    const text = await res.text().catch(() => '');
    if (!text) return { json: null as any, text: '' };
    try {
      return { json: JSON.parse(text), text };
    } catch {
      return { json: null as any, text };
    }
  };

  const testConnection = async (token = apiKey.trim()) => {
    if (!token) {
      addToast('Cole uma API key para testar.', 'warning');
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const commonHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': protocolVersion,
        // Prefer Bearer for MCP clients; also send X-Api-Key for compatibility.
        Authorization: `Bearer ${token}`,
        'X-Api-Key': token,
      };

      // 1) initialize
      const initRes = await fetch(endpointPath, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'crm-settings-ui', version: '0' }, capabilities: {} },
        }),
      });
      const initParsed = await parseJsonSafe(initRes);
      if (!initRes.ok || !initParsed.json?.result) {
        const msg =
          initParsed?.json?.error?.message ||
          initParsed?.json?.error ||
          initParsed?.json?.message ||
          initParsed?.json?.detail ||
          initParsed?.json?.data?.error ||
          initParsed?.text ||
          'Falha ao conectar';
        setTestResult({ ok: false, message: `Erro no initialize: ${String(msg)}`, testedAtIso: new Date().toISOString() });
        return;
      }

      // 2) tools/list
      const listRes = await fetch(endpointPath, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      const listParsed = await parseJsonSafe(listRes);
      if (!listRes.ok || !Array.isArray(listParsed.json?.result?.tools)) {
        const msg =
          listParsed?.json?.error?.message ||
          listParsed?.json?.error ||
          listParsed?.json?.message ||
          listParsed?.json?.detail ||
          listParsed?.text ||
          'Falha ao listar tools';
        setTestResult({ ok: false, message: `Erro no tools/list: ${String(msg)}`, testedAtIso: new Date().toISOString() });
        return;
      }

      const tools = (listParsed?.json?.result?.tools as any[]) || [];
      if (!tools.length) {
        setTestResult({
          ok: false, toolsCount: 0,
          message: 'O CRM reconheceu a chave. Confira o acesso dela e as permissões de quem a criou neste escritório. Para o AgentMaker, confira também a liberação do módulo de agentes de IA.',
          testedAtIso: new Date().toISOString(),
        });
        return;
      }
      const toolsPreview = tools
        .map((t) => t?.name)
        .filter((v) => typeof v === 'string')
        .slice(0, 8) as string[];

      setTestResult({
        ok: true,
        message: 'Conectado. MCP respondeu corretamente.',
        toolsCount: tools.length,
        toolsPreview,
        testedAtIso: new Date().toISOString(),
      });
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || 'Erro no teste', testedAtIso: new Date().toISOString() });
    } finally {
      setTesting(false);
    }
  };

  const connectMagic = async () => {
    // Jobs-mode: one button. If no key, create one; then test.
    setConnecting(true);
    setTestResult(null);
    try {
      let token = apiKey.trim();
      if (!token) {
        const created = await createApiKeyInline();
        token = created?.trim() || '';
      }

      if (!token) return; // errors already toasted

      // Ensure input shows the key after auto-generate (and to make it feel “real”).
      setShowHaveKey(true);
      setTimeout(() => apiKeyInputRef.current?.focus(), 0);

      await testConnection(token);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <SettingsSection title="MCP" icon={ServerCog}>
      <div className="mt-4">
        {/* Jobs-mode hero */}
        <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 p-5">
          {!apiKey.trim() && <ApiKeyAccessField value={accessMode} onChange={setAccessMode} disabled={connecting || creatingKey} />}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-slate-900 dark:text-white">
                {testResult?.ok ? 'Pronto.' : 'Conectar ao MCP'}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {testResult?.ok
                  ? 'Seu MCP está respondendo. Copie a URL e conecte no seu cliente MCP.'
                  : 'Um clique: cria uma API key e testa a conexão.'}
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Endpoint: <span className="font-mono">{endpointPath}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!testResult?.ok ? (
                <button
                  type="button"
                  onClick={connectMagic}
                  disabled={connecting || creatingKey || testing}
                  className="px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
                >
                  {(connecting || creatingKey || testing) ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {(connecting || creatingKey || testing) ? 'Conectando…' : 'Conectar'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={copyUrlAndToken}
                  className="px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center gap-2"
                >
                  <Copy className="h-4 w-4" />
                  Copiar URL + Token
                </button>
              )}

              <button
                type="button"
                onClick={() => copy('URL do MCP', fullEndpoint)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-white text-sm font-semibold inline-flex items-center gap-2"
              >
                <Copy className="h-4 w-4" />
                Copiar URL
              </button>
            </div>
          </div>

          {testResult?.ok && (
            <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4">
              <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Conectado
              </div>
              <div className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-200/80">
                Tools disponíveis: <span className="font-semibold">{testResult.toolsCount ?? 0}</span>
                {typeof testResult.toolsCount === 'number' && testResult.toolsCount > 0 && testResult.toolsPreview?.length ? (
                  <>
                    {' '}
                    · Ex.: <span className="font-mono">{testResult.toolsPreview[0]}</span>
                  </>
                ) : null}
              </div>
              <div className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-white/70 dark:bg-black/20 p-3">
                <div className="text-xs text-slate-700 dark:text-slate-200 mb-2">
                  O que você precisa:
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={copyUrlAndToken}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copiar URL + Token
                  </button>
                  <button
                    type="button"
                    onClick={() => copy('URL do MCP', fullEndpoint)}
                    className="px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-white/70 dark:bg-black/20 hover:bg-white text-emerald-800 dark:text-emerald-200 text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copiar URL
                  </button>
                </div>
              </div>
            </div>
          )}

          {testResult && !testResult.ok && (
            <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4">
              <div className="text-sm font-semibold text-rose-800 dark:text-rose-200 inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {testResult.toolsCount === 0 ? 'Nenhuma ferramenta disponível para esta chave' : 'Não foi possível conectar'}
              </div>
              <div className="mt-1 text-xs text-rose-800/80 dark:text-rose-200/80">{testResult.message}</div>
            </div>
          )}
        </div>

        {/* "Tenho uma chave" (progressive disclosure) */}
        <div className="mt-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHaveKey((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100"
          >
            <span>Já tenho uma API key</span>
            <ChevronDown className={`h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform ${showHaveKey ? 'rotate-180' : ''}`} />
          </button>
          {showHaveKey && (
            <div className="px-4 pb-4">
              <div className="text-xs text-slate-600 dark:text-slate-300 mb-3">
                Cole a chave (não é salva). Autenticação: <span className="font-mono">Authorization: Bearer {'<API_KEY>'}</span>.
              </div>
          <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  ref={apiKeyInputRef}
                  className="min-w-[260px] flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white font-mono text-xs"
                  placeholder="Cole aqui sua API key"
                />
                <button
                  type="button"
                  onClick={() => testConnection()}
                  disabled={testing}
                  className="px-3 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
                >
                  <Play className="h-4 w-4" />
                  {testing ? 'Testando…' : 'Testar'}
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Precisa revogar/ver histórico? <button type="button" onClick={navigateToApiKeys} className="underline">Gerenciar API keys</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
};

