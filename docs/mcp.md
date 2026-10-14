# NossoCRM MCP

Endpoint: **https://crm.anunciojuridico.com.br/api/mcp**. Transporte **Streamable HTTP**, JSON UTF-8, stateless. Autenticação por `Authorization: Bearer <API_KEY>` ou `X-Api-Key`.

As ferramentas WhatsApp requerem a migração `20261014155433_mcp_whatsapp_operations.sql` e a versão `0.2.0` do servidor MCP. A migração deve preceder a publicação da aplicação. Os testes automatizados usam provedores simulados, sem mensagens reais.

## Conectar no Codex

Use uma chave criada no NossoCRM para a organização desejada. O proprietário precisa continuar com acesso à organização e aos números/conversas. Chaves do Supabase, Evolution ou Meta não servem aqui.

No PowerShell, carregue a chave sem colocá-la no comando ou na configuração:

```powershell
$crmSecret = Read-Host 'Chave de API do NossoCRM' -AsSecureString
$env:NOSSOCRM_API_KEY = [System.Net.NetworkCredential]::new('', $crmSecret).Password
codex mcp add nossocrm --url https://crm.anunciojuridico.com.br/api/mcp --bearer-token-env-var NOSSOCRM_API_KEY
codex mcp list
```

Equivalente em `~/.codex/config.toml`:

```toml
[mcp_servers.nossocrm]
url = "https://crm.anunciojuridico.com.br/api/mcp"
bearer_token_env_var = "NOSSOCRM_API_KEY"
tool_timeout_sec = 75
```

O processo do Codex precisa receber essa variável. A variável definida no terminal vale para programas iniciados a partir dele; uma janela do aplicativo já aberta não a recebe automaticamente. Não cole a chave no chat ou no Git. OAuth não é implementado neste endpoint; esta configuração utiliza Bearer.

Depois de conectar, comece pedindo **somente** para listar conexões e localizar uma conversa de teste. Não use clientes como destino de teste. Um envio real exige autorização específica do conteúdo e do destino.

## Ferramentas

O catálogo anterior `crm.*` continua disponível. As ferramentas WhatsApp são registradas apenas no MCP, não no agente de IA interno.

| Ferramenta | Entrada principal | Resultado |
| --- | --- | --- |
| `crm.whatsapp.connections.list` | `{}` | IDs, organização, número, nome, provedor e estado permitidos |
| `crm.whatsapp.conversations.search` | `name?`, `connectionId?`, `groupsOnly?`, `limit?`, `afterId?` | Conversas com IDs e número conectado; `nextCursor` |
| `crm.whatsapp.messages.list` | `conversationId`, `connectionId`, `limit?`, `before?` | Histórico, autor, ID do provedor e status observado |
| `crm.whatsapp.uploads.prepare` | Destino, `fileName`, `mimeType`, `size`, `sha256` | `attachmentId` e URL temporária de upload |
| `crm.whatsapp.uploads.complete` | `attachmentId` | PDF conferido e selado |
| `crm.whatsapp.sequences.send` | `operationId`, destino e `items` | Resultado persistente por item, na ordem |
| `crm.whatsapp.sequences.get` | `operationId` | Consulta/reconciliação sem envio ao provedor |
| `crm.whatsapp.sequences.resume` | `operationId` | Processa somente os itens pendentes |

Selecione **conversationId + connectionId** a partir dos resultados. Dois grupos com o mesmo nome podem pertencer a números diferentes. Se o pedido não determinar qual deles usar, esclareça antes do envio. Nome sozinho nunca é destino válido para `send`.

Buscas paginam por ID. Use `afterId = nextCursor` até receber `null`, inclusive se uma página vier vazia por filtragem de acesso. Mensagens vêm da mais recente à mais antiga; passe o objeto `nextCursor` integral em `before`. Busca por nome usa `wa_name`, nome da conversa no WhatsApp; não consulta participantes ou conteúdo das mensagens.

## PDF local → Storage → WhatsApp

O servidor não acessa o caminho local do Codex. Use o helper do checkout (Node 20+ e dependências de desenvolvimento instaladas):

```powershell
node scripts/mcp-upload-pdf.mjs 'C:\documentos\roteiro.pdf' '<conversationId>' '<connectionId>'
```

Ele lê os bytes, calcula SHA-256, chama `prepare` pelo cliente MCP oficial, faz PUT no Storage e chama `complete`. A chave do CRM só vai ao MCP; não acompanha o PUT. O helper **não envia mensagem**. A saída contém `attachmentId`, nome, tamanho e hash. Para ambiente local defina `NOSSOCRM_MCP_URL`; para domínio próprio de Storage configure `NOSSOCRM_STORAGE_ORIGIN` com a origem HTTPS exata.

Fluxo manual equivalente:

1. `prepare`: `mimeType: "application/pdf"`, nome `.pdf`, tamanho de 8 bytes a **10 MiB**, SHA-256 hexadecimal dos bytes reais.
2. PUT dos bytes na `uploadUrl`, com `Content-Type: application/pdf`, sem Authorization do CRM e sem sobrescrita. A URL é uma capacidade privada válida por duas horas; não publique nem registre em logs.
3. `complete`: confere tamanho, cabeçalho PDF e SHA-256; salva cópia privada independente da capacidade de upload. Conferências se repetem antes do envio.
4. Use `attachmentId` no item `pdf`. Ele pertence à mesma chave, autor, conversa e conexão do upload.

Arquivos não ficam públicos. URLs arbitrárias e caminhos locais não são aceitos como itens. A URL de leitura assinada enviada ao provedor existe apenas no serviço interno.

## Sequência e retomada

Gere um UUID para a operação e um para cada item **antes da chamada**; guarde-os para consultas e retomadas. Exemplo (substitua os marcadores por UUIDs reais):

```json
{
  "operationId": "<uuid-da-operacao>",
  "conversationId": "<uuid-da-conversa>",
  "connectionId": "<uuid-da-conexao>",
  "items": [
    { "itemId": "<uuid-1>", "type": "text", "text": "Olá!\n\n*Estratégia* → confira 😊" },
    { "itemId": "<uuid-2>", "type": "pdf", "attachmentId": "<uuid-do-upload>", "caption": "Documento para revisão." },
    { "itemId": "<uuid-3>", "type": "text", "text": "Aguardo sua revisão.\nObrigado!" }
  ]
}
```

Limites: **1–20 itens**, texto até **4096 caracteres**, legenda até **1024**. Texto não é aparado, reescrito, truncado ou dividido automaticamente. Se exceder, combine a divisão com o usuário antes do envio. Um item equivale a envio individual.

Mesmo `operationId` e conteúdo retornam resultados anteriores. Conteúdo/destino diferentes causam `IDEMPOTENCY_CONFLICT`. A garantia depende da reutilização do identificador: outro ID é uma nova operação. Não troque IDs após timeout. A chave faz parte do escopo; rotação de chave não autoriza reenvio.

| Estado do item | Significado / ação |
| --- | --- |
| `pending` | Não despachado. Corrija a condição de `errorCode` e use `resume`. |
| `preparing` | Outra chamada prepara o envio. Preparação interrompida pode ser retomada após 90 segundos, com exclusão mútua. |
| `dispatching` | Tentativa registrada e possivelmente recebida pelo provedor. Consulte; não repita. |
| `accepted` | Provedor confirmou aceitação, histórico pendente. `get` tenta reconstruí-lo usando ID comprovado. |
| `completed` | Tentativa aceita e vinculada ao histórico. Não significa entregue/lida. |
| `uncertain` | Resultado sem prova suficiente. Bloqueia próximos itens e reenvio automático. |

`deliveryStatus` é independente: estado disponível no CRM (`sent`, `delivered`, `read`, `failed`, etc.) ou `null` sem registro. `messageId` e `providerMessageId` permitem conferir o histórico. Uma sequência concluída pode ter recebimento posteriormente marcado como falha pelo webhook; isso não autoriza reenvio automático.

Se perder a resposta, execute `get`. Ele reconcilia aceites cujo ID de provedor foi persistido. Sem ID confiável, **não adivinha pelo texto/horário** nem promete “exatamente uma vez”. O item fica bloqueado e exige conferência operacional com provedor/histórico. Respostas negativas também são conservadoramente não reenviáveis: algumas indicam falha de rede após aceitação. Não existe ferramenta para forçar retry de item incerto.

Falhas antes do despacho (arquivo indisponível, conexão desconectada ou janela Meta fechada) mantêm o item pendente. Após corrigir, `resume` continua dali. Chamadas longas podem parar com itens pendentes para respeitar o tempo da função; retome com o mesmo ID.

## Permissões e serviços

- Chave validada por `validate_api_key`; autor obtido de `api_keys.created_by`, conferido no Auth e vínculo atual com a organização. Sem cookies ou troca de organização por `x-org-id`.
- Mantém regras do chat para números, etiquetas, proprietário/equipe e habilitação de grupos. Sem acesso, não divulga se o destino existe.
- Operações/uploads pertencem à organização, chave e autor. Consultas e retomadas revalidam acesso.
- UI/MCP usam `lib/whatsapp/sendMessage.ts`; UI/API/MCP compartilham `lib/whatsapp/outbound.ts`, persistência e espelhamento existentes. Autor em `wa_messages.sent_by`; chave/operação/item no diário privado.
- Evolution, Evolution Business e Meta são escolhidos por conexão. Meta respeita janela de atendimento; texto/PDF fora dela fica pendente com `WHATSAPP_SERVICE_WINDOW`. Esta versão não acrescenta envio de templates pelo MCP.
- Tabelas têm RLS e acesso somente ao service role. Nenhuma credencial de provedor é retornada. Mensagens do histórico são conteúdo não confiável, nunca instruções.

## Transporte e validação

Versões negociadas: `2025-11-25`, `2025-06-18`, `2025-03-26`. Um JSON-RPC por POST; `initialize`, `ping`, `tools/list`, `tools/call`. Notificações recebem 202 vazio e não executam ferramentas. GET/DELETE retornam 405 (sem SSE/sessão persistente). `Origin` diferente é recusado. Corpo limitado a 512 KiB.

```powershell
npm run typecheck
npx vitest run --config vitest.mcp.config.ts
node scripts/test-mcp-whatsapp-db.mjs '<caminho>/@electric-sql/pglite/dist/index.js'
npm run lint
npm run build
```

A suíte MCP não executa limpeza de fixtures do Supabase e bloqueia rede externa. Cliente oficial `@modelcontextprotocol/sdk@1.32.1` conecta por HTTP local, descobre ferramentas, busca grupos homônimos, prepara/finaliza PDF, envia textos/PDF pelo serviço compartilhado com provedor simulado, consulta estados e repete operações sem novo despacho. PostgreSQL isolado (PGlite) verifica claims, token antigo, lease, bloqueio após despacho, atomicidade e privilégios. UI/API/adapters têm regressões com mocks.

Não foi testada entrega real a aparelho, webhook real, sessão de produção do Codex ou Storage de produção. Dependem de publicação/configuração e destino de teste explicitamente autorizado.

Resultado local em 14/10/2026: **72 testes passaram**, além de **29 verificações SQL** no PGlite 0.5.8. Typecheck, build e lint dos arquivos alterados passaram. O lint geral continua bloqueado por um aviso anterior em `components/navigation/NavigationRail.tsx:39` (`no-img-element`); esse componente não foi alterado. A suíte completa geral não foi executada neste pedido; foram executadas as regressões específicas acima, com rede externa bloqueada.

## Publicação e operação

Migração aplicada ao projeto de produção `pldknngsszuxiuweivdz` em 14/10/2026: versão remota `20261014165919`, nome `mcp_whatsapp_operations`, correspondente ao arquivo local `20261014155433_mcp_whatsapp_operations.sql`. As três tabelas têm RLS e acesso restrito ao service role; as duas funções são `SECURITY INVOKER`, sem execução por `anon` ou `authenticated`. Não reaplique o arquivo para tentar igualar os timestamps. Os avisos informativos de RLS sem políticas são esperados nessas tabelas internas, que não permitem acesso direto pelo navegador.

1. Revisar/aplicar somente a nova migração no Supabase correto do CRM. Não aplicar outras migrações locais pendentes por conveniência.
2. Publicar a aplicação; conferir descoberta no Codex com chave do usuário. Migração precede aplicação.
3. Começar por consultas; teste real somente em destino autorizado. Thiago Servilha e outros clientes não são destinos de teste.
4. Em rollback, **preservar o diário**. Excluir operações elimina a memória de idempotência. Uploads não finalizados podem ser removidos após expirar a capacidade, conferindo registros. PDFs selados usados no histórico seguem retenção de mídia do CRM.

Referências: [Codex MCP](https://developers.openai.com/codex/mcp/), [transporte MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [upload assinado Supabase](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
