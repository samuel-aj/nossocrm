# ZapSign Master Access Implementation Plan

**Goal:** Liberar configuração da ZapSign para o Mestre da organização, preservando o superadministrador.

**Architecture:** Reutilizar useTeamConfig na UI e getTeamAccess na API. Autorizar pelo masterUserId da organização da sessão; manter guardRoute para autenticação, papel e origem das mutações. Sem alteração no uso operacional de contratos.

**Tech Stack:** Next.js, TypeScript, TanStack Query, Supabase, Vitest/Testing Library.

Execução nesta sessão, sem delegação. Escopo já aprovado na conversa. Spec: ../specs/2026-11-05-zapsign-master-design.md.

## 1. Testar antes da alteração

- [x] Ampliar features/settings/SettingsPage.rbac.test.tsx: Mestre vê aba e abre hash; admin comum não vê; consulta pendente/erro não libera; transferência de Mestre remove aba; superadmin preservado. Mockar useTeamConfig e ZapSignSection; não acessar integrações reais.
- [x] Criar app/api/integrations/zapsign/settings/route.test.ts: invocar GET/PUT/DELETE com guardRoute/getTeamAccess e cliente ZapSign simulados. Mestre recebe sucesso; admin sem masterUserId correspondente recebe 403 antes de ler token ou chamar provedor; consulta falha recebe 503; mudança de organização usa organização autenticada; guard de sessão/origem preservado.
- [x] Executar os dois arquivos; confirmar falhas nos casos de Mestre antes da implementação.

## 2. Implementar permissão

- [x] Em features/settings/SettingsPage.tsx, importar useTeamConfig, ler user/profile e autorizar com:

```ts
const { data: teamConfig, isError: teamError } = useTeamConfig();
const canZapSign = profile?.role === UserRole.SUPER_ADMIN || (
  profile?.role === UserRole.ADMIN && !!user?.id && !teamError && teamConfig?.masterUserId === user.id
);
```

- [x] Em app/api/integrations/zapsign/settings/route.ts, criar guardSettings(req?) que chama guardRoute({ req, admin: true }); mantém superadmin; consulta getTeamAccess(auth.admin, auth.user.organizationId, auth.user.id) e aceita somente masterUserId === auth.user.id. Falha retorna 503 e divergência 403. Chamar esse guard nas três operações; retirar onlySuperAdmin.
- [x] No efeito do hash da UI, se hash zapsign e sem permissão, selecionar webhooks. Renderização da ZapSign continua condicionada a canZapSign.
- [x] Atualizar docs/zapsign-contratos.md com a nova regra, distinguindo a publicação histórica da alteração local.

## 3. Verificar e entregar

- [x] Rodar testes focados de permissões e regressão lib/zapsign, sem carregamento de credenciais ou cleanup de banco.
- [x] Rodar npm run typecheck, npm run lint e build se o ambiente permitir; documentar qualquer limitação existente.
- [x] Revisar git diff --check e escopo do diff; garantir ausência de migrações, tokens e alterações de dados.
- [x] Commitar a alteração na branch isolada codex/zapsign-master-access. Informar status local, sem alegar publicação.


## Validação

- Testes antes da mudança: 13 falhas que reproduziam a restrição antiga e a ausência do controle do Mestre.
- Depois: 66 testes aprovados (permissões da tela/API, equipe e regressões ZapSign), com banco e provedor simulados e sem cleanup de banco real.
- Typecheck e lint dos quatro arquivos TypeScript alterados aprovados.
- Lint global: um aviso preexistente em components/navigation/NavigationRail.tsx:39, next/no-img-element; arquivo inalterado em relação a main.
- Build de produção (webpack): aprovado, incluindo TypeScript e 161 páginas estáticas.
- Sem publicação, alterações de cargos, contratos ou mensagens reais.
