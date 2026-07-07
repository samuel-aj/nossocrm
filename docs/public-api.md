# Public API (Integrações) — NossoCRM

Este documento é o guia **humano** de integração (produto em primeiro lugar).  
O contrato técnico completo está no OpenAPI:

- `GET /api/public/v1/openapi.json`
- Swagger UI: `GET /api/public/v1/docs`

## Conceitos

- **API Key**: gerada na interface (Settings → Integrações → API). Cada chave dá acesso à **sua organização** (single-tenant).
- **Board**: seu pipeline/funil (ex.: “Vendas”, “Onboarding”).
- **Board Key (slug)**: identificador simples e estável (ex.: `vendas-b2b`) para integrar sem depender de UUID.

## Autenticação

Todas as chamadas usam:

- Header: `X-Api-Key: <sua-chave>`

## Rotas (v1)

- **Meta**
  - `GET /api/public/v1/me`
  - `GET /api/public/v1/openapi.json`
- **Boards**
  - `GET /api/public/v1/boards`
  - `GET /api/public/v1/boards/{boardKeyOrId}`
  - `GET /api/public/v1/boards/{boardKeyOrId}/stages`
- **Companies**
  - `GET /api/public/v1/companies`
  - `POST /api/public/v1/companies` (upsert)
  - `GET /api/public/v1/companies/{companyId}`
  - `PATCH /api/public/v1/companies/{companyId}`
- **Contacts**
  - `GET /api/public/v1/contacts`
  - `POST /api/public/v1/contacts` (upsert)
  - `GET /api/public/v1/contacts/{contactId}`
  - `PATCH /api/public/v1/contacts/{contactId}`
- **Deals**
  - `GET /api/public/v1/deals`
  - `POST /api/public/v1/deals` — aceita `owner_id`/`owner_email` para já cadastrar o **responsável** do lead. **Idempotente**: se o contato já tem negócio aberto no mesmo estágio (ou `external_id` repetido), responde `200` com o negócio existente (`action: "existing"`) em vez de erro
  - `GET /api/public/v1/deals/{dealId}`
  - `PATCH /api/public/v1/deals/{dealId}` — atualização unificada numa só chamada: muda etapa (`to_stage_id`/`to_stage_label`/`mark`), tags (`tags` ou `tags_add`/`tags_remove`), descrição (`description` substitui ou `description_append` anexa), **responsável** (`owner_id`/`owner_email`; `owner_id: null` limpa), `custom_fields`/`custom_fields_patch`, e cria `activity` inline
  - `POST /api/public/v1/deals/{dealId}/move-stage`
  - `POST /api/public/v1/deals/{dealId}/mark-won`
  - `POST /api/public/v1/deals/{dealId}/mark-lost`
- **Activities**
  - `GET /api/public/v1/activities`
  - `POST /api/public/v1/activities`

## Como identificar um Board (sem listar “pra sempre”)

Fluxo recomendado:

1) Abra o CRM e copie a **Chave do board (slug)** no modal de editar/criar board.
2) Na integração, use essa `board_key` para buscar etapas e criar/mover deals.

Alternativa (via API):

- `GET /api/public/v1/boards?q=vendas`
- `GET /api/public/v1/boards/{board_key}/stages`

## Erros (padrão)

O padrão de erro é:

```json
{ "error": "mensagem", "code": "CODIGO_OPCIONAL" }
```

## Paginação (padrão)

Listagens retornam:

```json
{ "data": [], "nextCursor": "..." }
```

