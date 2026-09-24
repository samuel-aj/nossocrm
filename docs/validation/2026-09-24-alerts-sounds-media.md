# Validação — alertas, sons e modelos com mídia

Direção aprovada: opção 2 (card verde completo), alerta reconhecido ao abrir o lead, três sons e volume, modelos oficiais com mídia. Código revisado até `124765c`; staging é o alvo. Produção não foi alterada.

## Evidências

- Sons: 18 testes; formulário preservou preferências antigas e prévia Campainha em 100% funcionou sem salvar alterações.
- Alertas: 93 testes direcionados; correções de filtros validadas por 21 testes. Revisão independente aprovou permissões, versão esperada e idempotência.
- Mídia: 74 testes direcionados; ajuste final de troca de conexão/callback tardio validado por 16 testes. Revisões da tarefa e do conjunto sem bloqueadores.
- Typecheck e lint passaram nas tarefas e no ajuste final. Build otimizado webpack da versão final passou, incluindo verificação TypeScript e geração de rotas.
- Banco staging: migrations `deal_recovery_alerts` e `message_template_media` aplicadas. Assertions SQL de organização, repetição, acknowledgement e grants passaram com rollback.
- API autenticada com staging: bloqueou escrita direta de alerta e RPC público, IDs antigos, origem externa e lead inexistente. Reconhecimento ocorreu só uma vez; aviso chegou ao responsável atual.
- Storage/API: upload PNG por URL assinada, conclusão e prévia com bytes corretos; arquivo privado inacessível pela URL pública; MIME/tamanho inválidos e conexão de outra organização rejeitados; metadados protegidos.
- Navegador na versão compilada: card verde com texto, lista, filtro e Limpar conferidos; abrir lead limpou alerta e registrou responsável; novo alerta apareceu sem recarregar. Novo bloco apareceu no canvas. Upload pela interface exibiu prévia e “pronto para usar”.
- Advisors: nenhuma nova advertência/erro de segurança. Dois INFO de RLS sem policy são intencionais nas tabelas de acesso exclusivo do servidor.
- Dados, arquivos e sessões temporários de teste removidos/revogados.

## Limites

Nenhum modelo foi submetido à Meta e nenhuma mensagem foi enviada. Aprovação e entrega real dependem da conexão e das permissões Meta quando o usuário fizer o uso intencional.

Mídia disponível em Meta Cloud. Conexões Evolution não possuem envio oficial de templates no provedor atual; modelos de texto mantêm comportamento legado. JPG/PNG até 5 MB; MP4 e PDF até 16 MB. O limite PDF é operacional do CRM. Arquivos abandonados permanecem privados; não foi incluída rotina de retenção nesta entrega.
