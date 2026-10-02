# Validação dos vínculos de grupos do WhatsApp

Branch: `feat/whatsapp-group-links`, baseada em `c5f1583`. Implementação e testes em homologação; sem alteração do Main ou da produção nesta entrega.

## Evidência

- Backend: 86 testes focados de configuração, autorização, vínculos e principal passaram. A integração dos webhooks elevou o conjunto focado para 104 testes, com typecheck aprovado. A revisão final acrescentou 12 casos de regressão: 116 testes de servidor passaram, com saída limpa.
- Banco: `supabase/tests/whatsapp_group_links.sql` passou integralmente após as migrações. A transação verifica isolamento entre organizações, identidade entre conexões, unicidade e integridade, principal, valor real/nulo/ausente, campos existentes e igualdade entre payload salvo e fila HTTP. Todos os dados e pedidos HTTP desse teste são revertidos.
- Concorrência pela API: inclusões simultâneas e escolhas simultâneas mantiveram apenas um principal. Oito verificações autenticadas da API passaram, incluindo desativação e rejeição de conversa privada como grupo.
- Interface: 64 testes focados passaram antes da revisão. O ajuste do editor e da tentativa de salvar a configuração passou em 19 testes focados, incluindo preservação da criação/edição de variáveis de IA nos agentes que a suportam.
- Navegador: grupo ligado a dois contatos e dois leads, persistência após recarregar, conversas privadas separadas, ID somente leitura e cópia exata, troca e remoção do principal, escolha do único grupo restante, atalho do contato, ocultação ao desativar e restauração ao reativar. Conferidos também o painel do lead no chat privado e as telas de grupo/lead em largura de 390 px, sem rolagem horizontal.
- A prévia publicada passou por nove cenários completos de navegador, incluindo desktop e celular, com zero erros de página ou respostas de erro nas APIs durante o ensaio.
- Build local de `907d6f4`: `next build --webpack` aprovado, 153 páginas geradas. Webpack foi usado porque as dependências locais estão em um diretório compartilhado por symlink. Typecheck e lint dos arquivos alterados passaram também em `c6d094d` e `c86c7fa`.
- Os consultores de segurança e desempenho do Supabase não apontaram novos avisos de nível WARN em relação à base de homologação.

As verificações de navegador usaram uma organização demonstrativa, conexões fictícias e bloqueio do envio de mensagens. Nenhuma mensagem real de WhatsApp foi enviada. O recebimento no AJ Ops não faz parte desta entrega.

A revisão final corrigiu a limpeza dos snapshots: somente o campo nativo e seu alias literal reservado são removidos antes de consultar o valor atual. Campos personalizados e outros objetos com chaves de mesmo nome são preservados, inclusive em templates e novas tentativas de envio. Os 12 casos novos falham contra a implementação anterior e passam contra a correção.

## Falhas anteriores à alteração

A suíte completa foi executada: 1.133 testes passaram e 12 falharam. Uma falha no teste de configurações foi causada pela nova consulta e corrigida no seu provedor de testes. As 11 restantes foram reproduzidas em um checkout isolado de `1764794`, com as mesmas dependências e ambiente:

| Teste | Falhas | Motivo observado |
| --- | ---: | --- |
| `lib/query/__tests__/cache-integrity.test.ts` | 4 | Expectativas existentes de chaves de cache e snapshot |
| `test/supabaseMiddleware.test.ts` | 1 | Esperava `/dashboard`, recebeu `/select-org` |
| `test/stories/US-001-abrir-deal-no-boards.test.tsx` | 1 | Mock sem `useOrgMembers` |
| `features/boards/components/Modals/CreateBoardModal.stages.test.tsx` | 5 | Provedor de consulta ausente no teste existente |

O teste de isolamento de ferramentas passou nas quatro verificações, mas sua limpeza falhou por uma referência de `boards_won_stage_id_fkey`. As quatro organizações temporárias desses dois ensaios foram removidas pelo controlador, usando IDs e nomes exatos. A organização demonstrativa do navegador foi mantida para a prévia.

O lint completo encontra um aviso anterior em `components/navigation/NavigationRail.tsx:39`, por uso de `img`. O mesmo aviso foi reproduzido na base. Assim, a suíte e o lint completos ainda não estão inteiramente verdes.

## Decisões aplicadas

1. O primeiro grupo vinculado se torna principal. Ao remover o principal, o ID fica nulo até uma escolha explícita. Uma preferência diferente exige ajustar a regra de seleção e sua interface.
2. O mesmo grupo compartilha vínculos entre conexões, usando organização, provedor e JID completo como identidade. Separar vínculos por conexão posteriormente exigiria migrar essas relações.
3. Ao desativar, propriedades de templates que dependem da variável do grupo são omitidas; cada nova tentativa consulta a configuração atual. O sistema destinatário precisa aceitar a ausência dessa propriedade opcional. Pedidos já em trânsito não podem ser recolhidos.

## Publicação

A prévia usa variáveis de ambiente específicas desta branch e o banco de homologação. A revisão final e a revisão da correção foram aprovadas, sem pendências. A versão publicada é conferida pelo controlador e informada na entrega. Nenhum receptor novo foi instalado no AJ Ops.
