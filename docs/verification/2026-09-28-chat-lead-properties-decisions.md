# Decisões de execução — propriedades e notas em Chats

Em ordem de registro. A especificação aprovada e a autorização de publicar no principal orientaram estas decisões.

| Decisão | Motivo | Custo se estiver errada |
|---|---|---|
| Executar o plano com implementação delegada e revisão, sem repetir a escolha de processo | Samuel aprovou a direção e pediu continuidade | Ajustar o processo de execução |
| Publicar no principal após validar, sem repetir autorização | Autorização explícita existente; staging reservado | Reverter a publicação se a interpretação do escopo estiver errada |
| Medir a referência antes de implementar | Comparação válida exige uma versão anterior preservada | Repetir as medições |
| Mostrar um único responsável do lead por vez; inicialmente supus que o responsável de Chats fosse outra entidade | Evitar controles duplicados | Poderia preservar um controle indevido; suposição corrigida abaixo antes da integração |
| A faixa de atividades pendentes pode usar atividades já presentes no cache canônico | Preservar tarefas antigas sem nova consulta global; a linha do tempo usa somente a página | Revisar a faixa caso apresente dados defasados |
| Adicionar erro estrito opcional às alterações/exclusões de atividades | O comportamento legado escondia falhas e impedia preservar o rascunho corretamente | Regressão de compatibilidade; chamadas antigas e novas foram cobertas |
| Recuperar intervalos após rajadas de mais de 50 eventos por paginação explícita; adicionar entrada própria para nova atividade agendada | Manter registros alcançáveis sem carregar todo o histórico automaticamente | Lacunas/duplicação ou criação como edição; regressões específicas cobrem ambos |
| Usar o mesmo contrato opcional de erro estrito em negócios, contatos e produtos | Preservar editores após falhas, sem mudar os chamadores antigos | Regressões de compatibilidade e rollback; cobertas por testes |
| Corrigir a suposição de responsável: o cabeçalho de Chats já exibe o responsável do lead | Código confirmou a entidade; manter cabeçalho quando propriedades fechadas e evitar duplicação quando abertas | Menor descoberta do controle; o campo editável permanece no painel |
| Registrar que os testes iniciais da extração foram escritos depois da implementação | Não inventar evidência histórica; falhas da revisão ganharam testes realmente vermelhos antes das correções | Menor garantia original de desenvolvimento orientado por testes, compensada por revisão independente e regressões |
| Manter a correção de geometria móvel aberta até a verificação real do navegador | A revisão de CSS não detectou o botão fora da tela; concluir o mesmo defeito antes de publicar | Pequeno retrabalho no cabeçalho responsivo e verificação adicional |

## Limites explícitos

- Sem reescrita do CRM ou conversão de tecnologia.
- Sem mudança de RLS ou banco nesta fase. A leitura usa o usuário autenticado e a organização do lead.
- Falhas anteriores da suíte e lint são separadas dos resultados desta mudança.
- Uma melhoria observada na janela de seleção não prova redução equivalente no carregamento completo do site. O menu recolhido também dispara prefetch de navegação; esse custo aparece separado no relatório.
