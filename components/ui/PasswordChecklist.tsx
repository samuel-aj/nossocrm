import { PASSWORD_RULE_LABELS, passwordRules } from '@/lib/security/passwordPolicy';

/** Lista de requisitos da senha, marcando o que já foi atendido enquanto a pessoa digita. */
export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  if (!password) return null;
  const rules = passwordRules(password);
  return (
    <div id={id} className="mt-2 space-y-1">
      <p className="text-xs text-slate-500 dark:text-slate-400">Requisitos:</p>
      <div className="grid grid-cols-2 gap-1 text-xs">
        {PASSWORD_RULE_LABELS.map(({ key, label }) => (
          <span key={key} className={rules[key] ? 'text-green-500' : 'text-slate-400'}>
            {rules[key] ? '✓' : '○'} {label}
          </span>
        ))}
      </div>
    </div>
  );
}
