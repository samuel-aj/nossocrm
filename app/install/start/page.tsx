'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Loader2, Shield } from 'lucide-react';

type InstallerMeta = {
  enabled: boolean;
  requiresToken: boolean;
};

type ProjectInfo = {
  id: string;
  name: string;
  teamId?: string;
  url?: string;
};

const STORAGE_TOKEN = 'crm_install_token';
const STORAGE_PROJECT = 'crm_install_project';
const STORAGE_INSTALLER_TOKEN = 'crm_install_installer_token';

const shouldShowTokenHelp = (message: string) => {
  const text = message.toLowerCase();
  return text.includes('vercel') && text.includes('token');
};

export default function InstallStartPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<InstallerMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [installerToken, setInstallerToken] = useState('');
  const [token, setToken] = useState('');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'validating' | 'confirm' | 'success'>(
    'input'
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/installer/meta');
        const data = await res.json();
        if (!cancelled) setMeta(data);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load installer metadata';
          setMetaError(message);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem(STORAGE_TOKEN);
    const savedProject = localStorage.getItem(STORAGE_PROJECT);
    const savedInstallerToken = localStorage.getItem(STORAGE_INSTALLER_TOKEN);

    if (savedInstallerToken) {
      setInstallerToken(savedInstallerToken);
    }

    if (savedToken && savedProject) {
      try {
        const parsedProject = JSON.parse(savedProject) as ProjectInfo;
        setToken(savedToken);
        setProject(parsedProject);
        setStep('confirm');
      } catch {
        localStorage.removeItem(STORAGE_PROJECT);
      }
    }
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!token.trim()) {
      setError('Token da Vercel e obrigatorio');
      return;
    }

    if (meta?.requiresToken && !installerToken.trim()) {
      setError('Installer token obrigatorio');
      return;
    }

    setIsLoading(true);
    setStep('validating');

    try {
      const response = await fetch('/api/installer/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          installerToken: installerToken.trim() || undefined,
          domain: typeof window !== 'undefined' ? window.location.hostname : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Erro ao validar token');
      }

      setProject(data.project);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao validar token');
      setStep('input');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!project) return;

    localStorage.setItem(STORAGE_TOKEN, token.trim());
    localStorage.setItem(STORAGE_PROJECT, JSON.stringify(project));

    if (installerToken.trim()) {
      localStorage.setItem(STORAGE_INSTALLER_TOKEN, installerToken.trim());
    }

    setStep('success');
    setTimeout(() => {
      router.push('/install/wizard');
    }, 800);
  };

  const handleReset = () => {
    setProject(null);
    setStep('input');
    setError('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="max-w-lg w-full relative z-10 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-200 dark:border-primary-900/40 mb-4">
            <Shield className="w-7 h-7 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Instalacao do CRM
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Precisamos do seu token da Vercel para detectar o projeto correto.
          </p>
        </div>

        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8 backdrop-blur-sm">
          {!meta && !metaError ? (
            <div className="flex items-center justify-center text-slate-600 dark:text-slate-300 py-8">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando instalador...
            </div>
          ) : null}

          {metaError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-900/20 p-3 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle size={16} className="mt-0.5" />
              <span>{metaError}</span>
            </div>
          ) : null}

          {meta && !meta.enabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm">
              <AlertCircle size={16} className="mt-0.5" />
              <span>Instalador desabilitado no servidor.</span>
            </div>
          ) : null}

          {meta?.enabled ? (
            <>
              {step === 'success' ? (
                <div className="text-center py-10">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary-500/10 mb-4 border border-primary-200 dark:border-primary-900/40">
                    <CheckCircle2 className="w-7 h-7 text-primary-600 dark:text-primary-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                    Projeto confirmado!
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    Redirecionando para o wizard...
                  </p>
                </div>
              ) : step === 'confirm' && project ? (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                      Projeto encontrado
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Confirme se este e o projeto correto.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Nome</span>
                      <span className="text-slate-900 dark:text-white font-medium">
                        {project.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">URL</span>
                      <a
                        href={`https://${project.url || `${project.name}.vercel.app`}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
                      >
                        {project.url || `${project.name}.vercel.app`}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Dominio atual</span>
                      <span className="text-slate-900 dark:text-white font-mono">
                        {typeof window !== 'undefined' ? window.location.hostname : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex-1 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 font-medium py-3 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 active:scale-[0.99]"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirm}
                      className="flex-1 bg-primary-600 hover:bg-primary-500 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 active:scale-[0.98]"
                    >
                      Confirmar
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                      Token da Vercel
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Vamos usar seu token para configurar as envs automaticamente.
                    </p>
                  </div>

                  {meta.requiresToken ? (
                    <div className="space-y-2">
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        Installer token
                      </label>
                      <input
                        value={installerToken}
                        onChange={(e) => setInstallerToken(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                        placeholder="Token interno (opcional)"
                        disabled={isLoading}
                      />
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Vercel PAT
                    </label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 font-mono text-sm"
                      placeholder="pat_xxx"
                      disabled={isLoading}
                    />
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-600 dark:text-slate-300">
                    <p className="font-medium mb-2 text-slate-700 dark:text-slate-200">
                      Como obter o token:
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                      Site oficial da Vercel:{' '}
                      <a
                        href="https://vercel.com/account/tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        vercel.com/account/tokens
                      </a>
                    </p>
                    <ol className="space-y-2 text-slate-500 dark:text-slate-400">
                      <li>1) Acesse vercel.com/account/tokens</li>
                      <li>2) Clique em Create Token</li>
                      <li>3) Scope: Full Account</li>
                      <li>4) Copie o token</li>
                      <li>5) Cole aqui e avance</li>
                    </ol>
                  </div>

                  {error ? (
                    <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <div className="space-y-1">
                        <span className="block">{error}</span>
                        {shouldShowTokenHelp(error) ? (
                          <span className="block text-xs text-red-500 dark:text-red-300">
                            Gere um novo token em{' '}
                            <a
                              href="https://vercel.com/account/tokens"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              vercel.com/account/tokens
                            </a>
                            .
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={isLoading || !token.trim()}
                    className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 active:scale-[0.98]"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        Continuar
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </>
          ) : null}
        </div>

        <p className="text-center text-slate-400 dark:text-slate-500 text-xs mt-6">
          Seu token e usado apenas para configurar as envs do projeto.
        </p>
      </div>
    </div>
  );
}
