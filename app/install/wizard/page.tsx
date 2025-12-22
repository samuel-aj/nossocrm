'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Shield } from 'lucide-react';

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

type Step = {
  id: string;
  status: 'ok' | 'error' | 'warning' | 'running';
  message?: string;
};

type RunResult = {
  ok: boolean;
  steps: Step[];
  error?: string;
};

const wizardSteps = [
  { id: 'vercel', label: 'Vercel' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'admin', label: 'Admin' },
  { id: 'review', label: 'Review' },
];

const STORAGE_TOKEN = 'crm_install_token';
const STORAGE_PROJECT = 'crm_install_project';
const STORAGE_INSTALLER_TOKEN = 'crm_install_installer_token';

const shouldShowTokenHelp = (message: string) => {
  const text = message.toLowerCase();
  return text.includes('vercel') && text.includes('token');
};

function maskValue(value: string, start = 4, end = 4) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= start + end) return `${trimmed.slice(0, start)}...`;
  return `${trimmed.slice(0, start)}...${trimmed.slice(-end)}`;
}

export default function InstallWizardPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<InstallerMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [installerToken, setInstallerToken] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseServiceKey, setSupabaseServiceKey] = useState('');
  const [supabaseDbUrl, setSupabaseDbUrl] = useState('');

  const [companyName, setCompanyName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [targets, setTargets] = useState({ production: true, preview: true });
  const [currentStep, setCurrentStep] = useState(0);

  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

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

    if (!savedToken || !savedProject) {
      router.replace('/install/start');
      return;
    }

    try {
      const parsedProject = JSON.parse(savedProject) as ProjectInfo;
      setVercelToken(savedToken);
      setProject(parsedProject);
      if (savedInstallerToken) setInstallerToken(savedInstallerToken);
      setIsHydrated(true);
    } catch {
      localStorage.removeItem(STORAGE_PROJECT);
      router.replace('/install/start');
    }
  }, [router]);

  useEffect(() => {
    if (installerToken.trim()) {
      localStorage.setItem(STORAGE_INSTALLER_TOKEN, installerToken.trim());
    }
  }, [installerToken]);

  const selectedTargets = useMemo(() => {
    return (Object.entries(targets).filter(([, v]) => v).map(([k]) => k) as Array<
      'production' | 'preview'
    >);
  }, [targets]);

  const passwordValid = adminPassword.length >= 6;
  const passwordsMatch =
    adminPassword.length > 0 && adminPassword === confirmPassword;

  const vercelReady = Boolean(
    (!meta?.requiresToken || installerToken.trim()) &&
      vercelToken.trim() &&
      project?.id &&
      selectedTargets.length > 0
  );

  const supabaseReady = Boolean(
    supabaseUrl.trim() &&
      supabaseAnonKey.trim() &&
      supabaseServiceKey.trim() &&
      supabaseDbUrl.trim()
  );

  const adminReady = Boolean(
    companyName.trim() && adminEmail.trim() && passwordValid && passwordsMatch
  );

  const canInstall = Boolean(meta?.enabled && vercelReady && supabaseReady && adminReady);
  const stepReady = [vercelReady, supabaseReady, adminReady, canInstall];

  const runInstaller = async () => {
    if (!canInstall || installing || !project) return;
    setInstalling(true);
    setRunError(null);
    setResult(null);

    try {
      const res = await fetch('/api/installer/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          vercel: {
            token: vercelToken.trim(),
            teamId: project.teamId,
            projectId: project.id,
            targets: selectedTargets,
          },
          supabase: {
            url: supabaseUrl.trim(),
            anonKey: supabaseAnonKey.trim(),
            serviceRoleKey: supabaseServiceKey.trim(),
            dbUrl: supabaseDbUrl.trim(),
          },
          admin: {
            companyName: companyName.trim(),
            email: adminEmail.trim(),
            password: adminPassword,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Installer failed (HTTP ${res.status})`);
      }
      setResult(data as RunResult);
      if (!data?.ok && data?.error) {
        setRunError(data.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Installer failed';
      setRunError(message);
    } finally {
      setInstalling(false);
    }
  };

  const statusColor = (status: Step['status']) => {
    switch (status) {
      case 'ok':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'warning':
        return 'text-amber-600 dark:text-amber-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-slate-500 dark:text-slate-400';
    }
  };

  const redeployWarning =
    result?.steps?.find((step) => step.id === 'vercel_redeploy' && step.status === 'warning') ||
    null;

  const progress =
    wizardSteps.length > 1
      ? Math.round((currentStep / (wizardSteps.length - 1)) * 100)
      : 0;

  const goNext = () => {
    if (!stepReady[currentStep]) return;
    setCurrentStep((step) => Math.min(step + 1, wizardSteps.length - 1));
  };

  const goBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const handleResetProject = () => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_PROJECT);
    router.push('/install/start');
  };

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-2xl relative z-10 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-200 dark:border-primary-900/40 mb-4">
            <Shield className="w-7 h-7 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Instalacao do CRM
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Wizard guiado para provisionar Vercel, Supabase e admin inicial.
          </p>
        </div>

        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl p-8 shadow-xl backdrop-blur-sm space-y-6">
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
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {wizardSteps.map((step, index) => {
                    const isActive = index === currentStep;
                    const isDone = index < currentStep;
                    return (
                      <div
                        key={step.id}
                        className={`flex items-center gap-2 ${
                          isActive ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        <div
                          className={`h-7 w-7 rounded-full border flex items-center justify-center text-xs ${
                            isDone
                              ? 'bg-primary-600 text-white border-primary-600'
                              : isActive
                                ? 'bg-primary-600 text-white border-primary-600'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                          }`}
                        >
                          {index + 1}
                        </div>
                        <span>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {currentStep === 0 ? (
                <div className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
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
                      />
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Projeto</span>
                      <span className="text-slate-900 dark:text-white font-medium">
                        {project?.name || '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">URL</span>
                      <span className="text-slate-700 dark:text-slate-200">
                        {project?.url || '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">PAT</span>
                      <span className="text-slate-700 dark:text-slate-200">
                        {maskValue(vercelToken)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetProject}
                      className="inline-flex items-center gap-2 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-500"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Trocar token/projeto
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Envs alvo
                    </label>
                    <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={targets.production}
                          onChange={(e) =>
                            setTargets((prev) => ({ ...prev, production: e.target.checked }))
                          }
                          className="accent-primary-600"
                        />
                        Production
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={targets.preview}
                          onChange={(e) =>
                            setTargets((prev) => ({ ...prev, preview: e.target.checked }))
                          }
                          className="accent-primary-600"
                        />
                        Preview
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              {currentStep === 1 ? (
                <div className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Project URL
                    </label>
                    <input
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                      placeholder="https://xxxx.supabase.co"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Anon key
                    </label>
                    <input
                      value={supabaseAnonKey}
                      onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                      placeholder="eyJhbGciOi..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Service role key
                    </label>
                    <input
                      value={supabaseServiceKey}
                      onChange={(e) => setSupabaseServiceKey(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                      placeholder="eyJhbGciOi..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      DB connection string
                    </label>
                    <input
                      value={supabaseDbUrl}
                      onChange={(e) => setSupabaseDbUrl(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                      placeholder="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Use a string de conexao do projeto (Settings &gt; Database).
                    </p>
                  </div>
                </div>
              ) : null}

              {currentStep === 2 ? (
                <div className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Nome da empresa
                    </label>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                      placeholder="Acme Corp"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Email do admin
                    </label>
                    <input
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                      placeholder="admin@empresa.com"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        Senha
                      </label>
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                        placeholder="Min 6 caracteres"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        Confirmar senha
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                        placeholder="Repita a senha"
                      />
                    </div>
                  </div>

                  {!passwordValid && adminPassword.length > 0 ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Senha deve ter no minimo 6 caracteres.
                    </p>
                  ) : null}
                  {adminPassword.length > 0 && !passwordsMatch ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Senhas nao conferem.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {currentStep === 3 ? (
                <div className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Vercel
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Projeto: {project?.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        URL: {project?.url}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        PAT: {maskValue(vercelToken)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Envs: {selectedTargets.join(', ')}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Supabase
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        URL: {supabaseUrl}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Anon: {maskValue(supabaseAnonKey)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Service: {maskValue(supabaseServiceKey)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        DB: {maskValue(supabaseDbUrl, 12, 10)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Admin
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Empresa: {companyName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Email: {adminEmail}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50">
                    Esse passo vai configurar envs na Vercel, aplicar o schema no Supabase,
                    criar o admin inicial e disparar um redeploy.
                  </div>

                  <button
                    type="button"
                    onClick={runInstaller}
                    disabled={!canInstall || installing}
                    className="w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 active:scale-[0.98]"
                  >
                    {installing ? (
                      <>
                        <Loader2 className="animate-spin h-5 w-5 mr-2" />
                        Instalando...
                      </>
                    ) : (
                      'Instalar agora'
                    )}
                  </button>

                  {runError ? (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-900/20 p-3 text-red-600 dark:text-red-400 text-sm">
                      <AlertCircle size={16} className="mt-0.5" />
                      <div className="space-y-1">
                        <span className="block">{runError}</span>
                        {shouldShowTokenHelp(runError) ? (
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

                  {result ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Resultado
                      </h3>
                      <div className="space-y-1">
                        {result.steps?.map((step) => (
                          <div key={step.id} className="flex items-center gap-2 text-sm">
                            <CheckCircle2
                              size={14}
                              className={statusColor(step.status)}
                            />
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {step.id}
                            </span>
                            <span className={statusColor(step.status)}>
                              {step.status}
                            </span>
                            {step.message ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {step.message}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {result.ok ? (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          Instalacao concluida. Aguarde o redeploy e faca login com o admin.
                        </p>
                      ) : null}
                      {redeployWarning ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Redeploy falhou via API. Dispare um redeploy manual no Vercel.
                        </p>
                      ) : null}
                      {result.ok ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          O instalador sera desativado automaticamente apos o deploy.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={currentStep === 0 || installing}
                  className="px-3 py-2 rounded-lg text-sm border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 active:scale-[0.99]"
                >
                  Voltar
                </button>
                {currentStep < wizardSteps.length - 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!stepReady[currentStep]}
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-500 transition-all disabled:opacity-50 shadow-lg shadow-primary-500/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 active:scale-[0.98]"
                  >
                    Avancar
                  </button>
                ) : (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {canInstall ? 'Pronto para instalar.' : 'Revise os dados antes de instalar.'}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
