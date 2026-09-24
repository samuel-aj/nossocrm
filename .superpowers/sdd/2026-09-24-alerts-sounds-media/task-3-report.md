# Task 3 — Modelos com mídia

Implementado no branch `feat/staging-alerts-media-sounds`, sobre `c5ab34d`. Nenhuma migration aplicada, mensagem enviada, template submetido, robô real alterado ou deploy realizado por este agente.

## Entrega

- Cabeçalhos image/video/document opcionais; texto livre/text-only preservados.
- Upload em duas etapas: JSON prepara ID/path server-owned + signed upload sem upsert; navegador sobe direto ao Storage privado; conclusão valida MIME, tamanho real e assinatura do arquivo. Não há entrada de URL remota nem fetch de URL fornecida pelo cliente.
- Bucket `wa-template-media`, tabela restrita a service_role com RLS, grants explícitos e FK composta para impedir vínculo de outra organização/conexão/tipo. Amostra Meta persistida separadamente da referência durável de Storage.
- Criação com Resumable Upload da Meta (App ID da conexão, fallback META_ES_APP_ID), handle em HEADER.example.header_handle. Nenhum token Meta/handle retornado ao cliente.
- Sync preserva tipo e mídia existente quando tipo não muda; remove vínculo se formato mudar. Importado começa sem arquivo, com indicação na lista. É possível vincular/substituir arquivo sem alterar o template aprovado na Meta.
- Interface com tipo, formatos/limites, upload e prévia imagem/vídeo/PDF; prévia do arquivo vinculado disponível via GET autenticado e URL de 10 minutos.
- Mesmo resolvedor de components no chat e robô: autoriza organização/conexão, exige upload validado, assina URL nova a cada envio. Modelo com mídia faltante não envia e não permite ativar robô; seletores indicam ou filtram modelos incompletos.

## Limitações reais

- Mídia habilitada apenas em `meta_cloud`. Verificados `lib/whatsapp/templates.ts`, `lib/whatsapp/providers/evolution.ts`, `lib/whatsapp/index.ts` e `lib/wa-agents/bots.ts`: Evolution tem criação/listagem mas seu provider não implementa sendTemplate. Não foi inventado suporte de envio; o chat bloqueia fallback de mídia para texto. O comportamento legado text-only permanece.
- Imagens JPG/PNG até 5 MB, vídeos MP4 até 16 MB, documentos PDF até 16 MB. PDF 16 MB é limite operacional deste fluxo, não uma alegação sobre limite máximo da Meta. O texto da UI pede H.264/AAC; codecs reais e validade semântica final continuam sujeitos à validação Meta. Servidor checa MIME/tamanho e magic bytes, não decodifica/transcodifica mídia.
- Aprovação/live send não foram executados, conforme autorização. Validação real de App ID/permissões de Resumable Upload deve ocorrer somente quando usuário submeter modelo intencionalmente.
- Uploads abandonados/substituídos ficam privados; não foi criado job de retenção/garbage collection. Referência ativa não expira. URLs de prévia podem ser renovadas pelo botão.
- Build, aplicação da migration, SQL/RLS real e browser ficam com controlador. Migration gerada via CLI oficial: `supabase/migrations/20260924143551_message_template_media.sql`.

## Validação local

Com `PATH=/Users/samuelmacario/.local/node/bin:$PATH`:

- `npx tsc --noEmit --incremental false`: passou, zero erros.
- ESLint nos 21 arquivos TypeScript/TSX alterados/novos: passou, zero erros/warnings após revisão React (Image unoptimized para prévia privada, handlers, labels e status/error acessíveis).
- `git diff --check`: passou.
- `npx vitest run app/api/message-templates/media/route.test.ts app/api/whatsapp/send/templateMedia.test.ts lib/whatsapp/templateMedia.test.ts lib/whatsapp/templates.media.test.ts lib/wa-agents/templateConnections.test.ts lib/wa-agents/botsEngine.test.ts features/wa-agents/canvas/serializeNewBlocks.test.ts app/api/whatsapp/send/mentions.test.ts`: 8 arquivos, 74 testes passaram.
- Casos: MIME/tamanho inclusive bytes reais, assinatura inválida, outra organização/conexão, path forjado, URL maliciosa nunca buscada, upload incompleto, CSRF/admin, headers dos 3 tipos na criação, sync sem buscar exemplos remotos, assinatura nova por envio, payload text-only, cabeçalho equivalente chat/robô, bloqueio antes de envio e ativação, regressão alert engine e menções.
- Teste de CSRF usa ambiente Node: Happy DOM remove o header Origin do Request e causava falso negativo no teste; não foi afrouxada proteção de produção.

## Fontes primárias consultadas

- https://www.postman.com/meta/whatsapp-business-platform/request/fw6itvt/upload-media-step-2-of-2-initiate-upload — sessão/handle e file_offset.
- https://www.postman.com/meta/whatsapp-business-platform/request/l9q0019/resumable-upload-query-file-upload-status — formato upload:...?... e autorização OAuth.
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/component_object/ — parâmetros header image/video/document (SDK arquivado, consultado junto coleção oficial Meta).
- https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl — transporte signed URL e upsert definido no servidor.
- https://github.com/supabase/storage-js/blob/main/src/packages/StorageFileApi.ts — createSignedUploadUrl.
- https://supabase.com/changelog.md — índice revisado; grants explícitos acomodam exposição Data API; sem alterações relevantes no transporte escolhido.

Skills usadas: Supabase e React best practices. Revisão final independente e verificação em staging pendentes do controlador.

## Polish final após revisão — troca de conexão

Ajuste pontual aprovado pelo controlador sobre `8c3ded3`:

- Trocar o número limpa tipo do cabeçalho, referência da mídia, vínculo com conexão e estado ocupado; nome/corpo permanecem. Meta Cloud → Evolution volta a permitir criar modelo sem mídia. Outra conexão Meta Cloud exige selecionar novo arquivo.
- Callback de upload desmontado é ignorado, evitando que um upload do número anterior sobrescreva o formulário após a troca.
- Fixtures dos dois testes novos de rotas foram reformatadas para leitura; sem mudança de comportamento.
- Regressões de interface: Meta Cloud → Evolution após upload concluído, troca para outra Meta Cloud durante upload e conclusão tardia de upload após desmontagem.

Validação desta onda (`PATH=/Users/samuelmacario/.local/node/bin:$PATH`):

- `npx vitest run features/settings/components/MessageTemplatesManager.media.test.tsx features/settings/components/TemplateMediaUpload.test.tsx app/api/message-templates/media/route.test.ts app/api/whatsapp/send/templateMedia.test.ts`: 4 arquivos, 16 testes passaram.
- `npx eslint features/settings/components/MessageTemplatesManager.tsx features/settings/components/TemplateMediaUpload.tsx features/settings/components/MessageTemplatesManager.media.test.tsx features/settings/components/TemplateMediaUpload.test.tsx app/api/message-templates/media/route.test.ts app/api/whatsapp/send/templateMedia.test.ts`: passou, zero erros/warnings.
- `npx tsc --noEmit --incremental false`: passou, zero erros.
- `git diff --check`: passou.

Nenhum build, servidor, banco, API Meta ou deploy acionado nesta onda. Revisão pontual final com o controlador.
