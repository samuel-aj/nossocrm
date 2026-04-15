# Guia: Configurar CRM para Novo Cliente

## Visao Geral

Quando um novo cliente fecha contrato com a Anuncio Juridico, precisamos:
1. Cadastrar os contatos/leads dele no CRM
2. Configurar o webhook da campanha para enviar leads automaticamente ao CRM via n8n

Existem **duas formas** de fazer isso: manualmente pelo painel ou via Claude Code.

---

## PARTE 1 — Setup Manual (pelo Painel)

### Passo 1: Acessar o CRM

1. Abra: **https://nossocrm-tau.vercel.app**
2. Faca login com seu email (precisa ser admin)

### Passo 2: Verificar o Board do Cliente

1. No menu lateral, clique em **Boards**
2. Verifique se o board **"Pipeline de Vendas"** esta ativo
3. Se precisar de um board separado para o cliente, clique no icone de engrenagem e crie um novo

### Passo 3: Cadastrar Lead Manualmente

1. Va em **Boards** > selecione o pipeline
2. Clique em **"+ Novo Negocio"** (botao azul no canto superior direito)
3. Preencha:
   - **Titulo**: Nome do lead + contexto (ex: "Joao Silva - Campanha Google")
   - **Contato**: Nome, email e/ou telefone
   - **Valor**: Valor estimado do negocio (se houver)
4. Clique em **Salvar**

### Passo 4: Cadastrar Contato Manualmente

1. Va em **Contatos** no menu lateral
2. Clique em **"+ Novo Contato"**
3. Preencha: Nome, Email, Telefone, Cargo, Empresa
4. Salve

### Passo 5: Configurar Webhook da Campanha no n8n

1. Acesse o n8n: **https://n8n.anunciojuridico.com.br**
2. Abra o workflow: **https://n8n.anunciojuridico.com.br/workflow/6BpFYPTJmUpjhzSd**
3. Este workflow ja esta ativo e recebe leads no endpoint:
   ```
   POST https://n8n.anunciojuridico.com.br/webhook/campanha-lead
   ```
4. Na plataforma de anuncios do cliente (Google Ads, Meta, etc), configure o webhook/postback para enviar os dados do lead para essa URL
5. O payload deve ser JSON com pelo menos:
   ```json
   {
     "name": "Nome do Lead",
     "email": "email@exemplo.com",
     "phone": "+5511999999999"
   }
   ```
6. Campos opcionais: `valor`, `value`, `source`

### Passo 6: Testar

Envie um teste via terminal ou Postman:
```bash
curl -X POST https://n8n.anunciojuridico.com.br/webhook/campanha-lead \
  -H "Content-Type: application/json" \
  -d '{"name":"Teste Manual","email":"teste@teste.com","phone":"+5511999990000"}'
```

Depois confira no CRM se o lead apareceu no board "Pipeline de Vendas".

---

## PARTE 2 — Setup via Claude Code (Automatizado)

### Pre-requisitos

- Ter o Claude Code instalado no computador
- Ter acesso ao repositorio do projeto (pasta `Agencia Anuncio Juridico`)

### Passo 1: Abrir o Claude Code

1. Abra o terminal na pasta do projeto:
   ```
   cd "C:\Users\SEU_USUARIO\Desktop\GRUPO ROCHA\Agencia Anuncio Juridico"
   ```
2. Execute:
   ```
   claude
   ```

### Passo 2: Pedir para o Claude cadastrar leads

Voce pode pedir diretamente em linguagem natural. Exemplos:

**Cadastrar um lead:**
```
Cadastra o lead "Maria Souza" (maria@email.com, +5511988887777) 
no CRM no board pipeline-de-vendas
```

**Cadastrar varios leads de uma vez:**
```
Cadastra esses leads no CRM:
- Joao Silva, joao@email.com, 11999991111
- Ana Paula, ana@email.com, 11999992222  
- Pedro Santos, pedro@email.com, 11999993333
```

**Verificar leads existentes:**
```
Lista os deals abertos no CRM
```

**Verificar se o webhook esta funcionando:**
```
Testa o webhook do n8n mandando um lead de teste pro CRM
```

### Passo 3: Configurar campanha de um cliente novo

Diga ao Claude:
```
Preciso configurar a campanha do cliente [NOME DO CLIENTE].
A plataforma de anuncios vai mandar webhook quando alguem se cadastrar.
Configura tudo no n8n pra os leads chegarem no CRM.
```

O Claude vai:
1. Verificar o workflow no n8n
2. Testar o endpoint
3. Confirmar que os leads estao chegando

### Passo 4: Criar webhook personalizado por cliente (se necessario)

Se quiser um webhook separado por cliente/campanha:
```
Cria um novo workflow no n8n com webhook separado para o cliente [NOME].
O board no CRM e "pipeline-de-vendas".
```

---

## PARTE 3 — Referencia Rapida

### URLs Importantes

| O que | URL |
|-------|-----|
| CRM (Painel) | https://nossocrm-tau.vercel.app |
| CRM API Docs | https://nossocrm-tau.vercel.app/api/public/v1/docs |
| n8n | https://n8n.anunciojuridico.com.br |
| Workflow n8n | https://n8n.anunciojuridico.com.br/workflow/6BpFYPTJmUpjhzSd |
| Webhook (campanha) | https://n8n.anunciojuridico.com.br/webhook/campanha-lead |

### API do CRM — Exemplos Rapidos

**Criar contato:**
```bash
curl -X POST https://nossocrm-tau.vercel.app/api/public/v1/contacts \
  -H "X-Api-Key: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Nome","email":"email@ex.com","phone":"+5511999999999"}'
```

**Criar deal (negocio):**
```bash
curl -X POST https://nossocrm-tau.vercel.app/api/public/v1/deals \
  -H "X-Api-Key: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Lead - Campanha",
    "board_key":"pipeline-de-vendas",
    "contact":{"name":"Nome","email":"email@ex.com","phone":"+5511999999999"}
  }'
```

**Listar deals:**
```bash
curl https://nossocrm-tau.vercel.app/api/public/v1/deals \
  -H "X-Api-Key: SUA_API_KEY"
```

### Payload do Webhook (o que a campanha deve enviar)

```json
{
  "name": "Nome do Lead",
  "email": "lead@email.com",
  "phone": "+5511999999999",
  "value": 0
}
```

Campos aceitos (PT ou EN):
- `name` ou `nome` — Nome do lead
- `email` — Email
- `phone`, `telefone` ou `whatsapp` — Telefone
- `value` ou `valor` — Valor estimado

### Convidar novo membro

No CRM, va em **Configuracoes > Equipe > Convidar** e coloque o email.
Ou peca ao Claude Code: "Convida fulano@email.com como admin no CRM"

---

## Credenciais (Somente para Admins)

- **API Key do CRM (n8n)**: Gerenciada em Configuracoes > Integracoes > API
- **Board padrao**: `pipeline-de-vendas`
- **Organizacao**: Escritorio Principal
