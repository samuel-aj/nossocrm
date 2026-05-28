# Guia: Implantar NossoCRM para um Cliente Novo

> **Quando usar este guia**: você (admin) recebeu um cliente novo e precisa colocar
> o CRM + captura de leads via n8n no ar, do zero, sem trabalho manual desnecessário.
>
> **Tempo estimado**: 15 a 25 minutos.

---

## Visão geral do fluxo

```
Anúncio / Form / Meta Lead Ads
            │
            ▼
   n8n (workflow do cliente)         ← você cria 1 clone por cliente
            │
            ▼
   POST nossocrm/api/public/v1/deals
   X-Api-Key: <chave do cliente>
            │
            ▼
   Board "Pipeline de Vendas"        ← criado automaticamente
   coluna "Descoberta"                  no signup do cliente
```

---

## Pré-requisitos

- Acesso admin ao NossoCRM (em https://nossocrm-tau.vercel.app)
- Acesso ao n8n (em https://n8n.anunciojuridico.com.br)
- Dados de contato do cliente

---

## Parte 1 — Setup no NossoCRM (5 min)

### 1.1 Criar a organização do cliente

1. Logue no NossoCRM como admin
2. Vá em **Configurações → Organizações**
3. Clique **"Nova organização"**
4. Preencha o nome (ex.: `Escritório Carmona & Rossi`) e salve

> O sistema **cria automaticamente** o board `Pipeline de Vendas` com as 5 colunas
> padrão (Descoberta, Proposta, Negociação, Ganho, Perdido). Não precisa criar manualmente.

### 1.2 Convidar o cliente (opcional)

Se o cliente vai usar o painel:

1. Em **Configurações → Equipe → Convidar**, cole o email dele
2. Defina o papel: `Admin` (ele gerencia tudo) ou `User` (só consulta)
3. Ele recebe email com link de cadastro

### 1.3 Gerar a API key do cliente

1. Faça login **como o cliente** (use o convite acima, ou troque pra organização dele em **Configurações → Organização**)
2. Vá em **Configurações → API (Integrações)**
3. No campo "Nome", digite `n8n`
4. Clique **Criar**
5. **Copie a chave imediatamente** — ela só aparece uma vez. Cola num gerenciador de senhas ou no Bitwarden compartilhado da agência.

A chave tem formato `ncrm_xxxxxxxxxxxxxxxx`.

> ⚠️ Se perder, **revogue a antiga** e gere outra. Nunca tente "recuperar".

---

## Parte 2 — Setup no n8n (10 min)

### 2.1 Duplicar o workflow padrão

1. Abra https://n8n.anunciojuridico.com.br/workflow/6BpFYPTJmUpjhzSd
2. Menu (`⋮` superior direito) → **Duplicate**
3. **Renomeie** pra incluir o nome do cliente:
   ```
   Webhook Campanha → NossoCRM | Carmona & Rossi
   ```
4. **NÃO ative ainda** — vamos editar primeiro

### 2.2 Trocar a credencial da API

1. Abra o node **"Criar Lead no CRM"** (HTTP Request)
2. Em **Authentication → Credentials**, clique no lápis ao lado da credencial atual ("NossoCRM API Key")
3. Clique **"Create New"**
4. Nome: `NossoCRM API Key — Carmona & Rossi` (ou nome do cliente)
5. Em **Header Auth**:
   - **Name**: `X-Api-Key`
   - **Value**: a chave que você copiou no passo 1.3
6. Salve

### 2.3 Trocar o path do webhook (URL única por cliente)

1. Abra o node **"Webhook Campanha"** (primeiro node)
2. No campo **Path**, troque de `campanha-lead` pra algo único:
   ```
   campanha-lead-carmonarossi
   ```
3. Salve

### 2.4 (Opcional, recomendado) Adicionar idempotência

Pra evitar leads duplicados em caso de erro de rede / retry do n8n:

1. No node **"Criar Lead no CRM"**, no Body Parameters, **adicione**:
   - **Name**: `external_id`
   - **Value**: `={{ $execution.id }}`

Com isso, se o n8n re-executar a chamada por qualquer motivo, o CRM detecta e retorna o deal existente em vez de criar um duplicado.

### 2.5 Ativar o workflow

1. Toggle **Active** no topo do workflow
2. Anote a URL final do webhook:
   ```
   https://n8n.anunciojuridico.com.br/webhook/campanha-lead-carmonarossi
   ```

---

## Parte 3 — Conectar com a fonte de leads (5 min)

Mande essa URL pro time do cliente (ou configure você mesmo, depende do caso):

### Caso A — Meta Lead Ads (Facebook/Instagram)
- O cliente conecta o Meta Lead Center à URL do webhook
- O n8n recebe o lead automaticamente quando alguém envia o form do anúncio

### Caso B — Formulário no site / landing page
- O cliente (ou o time de dev dele) faz o form submeter (POST JSON) pra URL do webhook:
  ```js
  fetch("https://n8n.anunciojuridico.com.br/webhook/campanha-lead-carmonarossi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, phone })
  })
  ```

### Caso C — Google Ads / outra plataforma
- A plataforma manda postback HTTP POST pra URL do webhook
- Campos aceitos: `name|nome`, `email`, `phone|telefone|whatsapp`, `value|valor`

---

## Parte 4 — Smoke test (2 min)

Antes de avisar o cliente que tá pronto, rode o teste fim-a-fim:

```bash
# do diretório nossocrm/
NOSSOCRM_URL=https://nossocrm-tau.vercel.app \
NOSSOCRM_API_KEY=ncrm_xxx_chave_do_cliente \
node scripts/smoke-deals.mjs
```

Saída esperada:
```
Smoke test → https://nossocrm-tau.vercel.app

✓ Autenticação (GET /me) — org=Carmona & Rossi
✓ Criar deal (board_key="pipeline-de-vendas") — id=abc12345… action=created
✓ Idempotência (repetir mesmo external_id) — id=abc12345… action=existing

✓ Smoke test OK. Deal criado: ...
```

Se algum passo falhar → veja a seção **Troubleshooting** abaixo.

---

## Parte 5 — Validação visual (2 min)

1. Abra https://n8n.anunciojuridico.com.br/webhook/campanha-lead-carmonarossi (teste real):
   ```bash
   curl -X POST https://n8n.anunciojuridico.com.br/webhook/campanha-lead-carmonarossi \
     -H "Content-Type: application/json" \
     -d '{"name":"Lead Teste Final","email":"teste-final@exemplo.com","phone":"+5511988887777"}'
   ```
2. Logue no CRM como o cliente, abra o board `Pipeline de Vendas`
3. Confirme que o card "Lead Teste Final" apareceu na coluna **Descoberta**
4. Apague o card de teste

---

## Troubleshooting

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| `401 Invalid API key` | Chave digitada errada ou revogada | Gere nova em Configurações → API |
| `422 Provide board_id or board_key` | Org não tem o board "Pipeline de Vendas" | A migration nova cria automaticamente. Se a org foi criada **antes** da migration, rode `SELECT seed_default_board('<org-id>')` no SQL editor do Supabase |
| `422 contact.name is required` | Lead chegou sem nome e o contato não existe ainda | Garantir que a plataforma de anúncio sempre envie pelo menos `name` ou que o n8n preencha default |
| Lead chega no n8n mas não vai pro CRM | Credencial errada ou URL do node errada | Abra a execução do workflow no n8n e veja o response do node HTTP Request |
| Lead duplicado quando o n8n re-executa | `external_id` não foi configurado no body | Voltar pro passo 2.4 e adicionar `external_id: {{ $execution.id }}` |

---

## Checklist final (revisar antes de declarar pronto)

- [ ] Organização criada no CRM
- [ ] Board "Pipeline de Vendas" visível com 5 colunas
- [ ] API key gerada e salva em local seguro
- [ ] Workflow do n8n clonado, renomeado e ativo
- [ ] Credencial do n8n trocada pela chave do cliente
- [ ] Path do webhook trocado pra URL única
- [ ] `external_id` configurado no body
- [ ] Smoke test (`npm run smoke:deals` ou comando acima) passou
- [ ] Teste real via curl chegou no board e apareceu na coluna Descoberta
- [ ] URL do webhook entregue ao cliente (ou conectada na plataforma de ads)

---

## Referência rápida

| Item | Valor |
|---|---|
| CRM | https://nossocrm-tau.vercel.app |
| API docs | https://nossocrm-tau.vercel.app/api/public/v1/docs |
| Endpoint deals | `POST /api/public/v1/deals` |
| Header de auth | `X-Api-Key: ncrm_...` |
| Board padrão (key) | `pipeline-de-vendas` |
| n8n | https://n8n.anunciojuridico.com.br |
| Workflow base (clonar este) | id `6BpFYPTJmUpjhzSd` |
| Smoke test | `node scripts/smoke-deals.mjs` |
