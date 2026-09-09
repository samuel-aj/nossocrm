# Preview com dados de demonstração

A staging incorpora a main d77ec24231baaecb3027e8639a3ce7208379dd52 (30 commits ausentes), preservando o relatório por eventos. A integração resolve a remoção dos controles de estratégia na página de relatórios que já tinha ocorrido na main.

Dados criados exclusivamente no Supabase de preview mggvzlmquzqcloprxmoe, na organização atual de Samuel. Nenhum dado foi copiado da produção.

Funil: DEMO — Relatórios (Ago/Set 2026)
ID: bb7b7e2b-2818-4579-ae20-bf052e51cf41
Identificador dos contatos/leads: DEMO-RELATORIOS-202609

100 leads e 100 contatos fictícios, todos atribuídos a Samuel, sem telefone e com emails example.invalid. Antes da inserção foram verificadas as automações: nenhum endpoint global ativo, nenhum agente ativo, único bot ativo com gatilho manual. Nenhum disparo externo é necessário para a demonstração.

| Período | Entradas | Qualificados | Ganhos | Perdas qualificadas | Desqualificadas | Qualificação | Fechamento | Receita |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Agosto 2026 | 50 | 30 | 10 | 10 | 5 | 60% | 33,3% | R$ 37.500 |
| Setembro 2026 | 50 | 40 | 15 | 10 | 5 | 80% | 37,5% | R$ 62.500 |

Exemplos: AGO 26 a 35 qualificaram em agosto e avançaram para proposta em setembro; AGO 36 a 45 entraram em agosto e qualificaram em setembro. AGO 26 a 30 e 36 a 40 fecharam em setembro. Todos os eventos simulados são anteriores a 9 de setembro; a criação de dados fictícios não altera o histórico dos leads existentes.

Validação: contagens mensais conferidas no banco, leitura dos 100 leads permitida sob RLS com a identidade de Samuel, 17 testes específicos do relatório e typecheck passaram. O navegador de automação ficou indisponível; não foi feita inspeção visual autenticada.

Para testar, selecione o funil acima em Relatórios > Performance e alterne Mês Passado / Este Mês. Em Boards, escolha Todos para visualizar também ganhos e perdas. As configurações e os dados particulares de produção continuam separados do preview.

A verificação da demonstração identificou e corrigiu um falso aviso de histórico ausente ao consultar agosto para leads qualificados apenas em setembro. A cobertura consulta todo o histórico disponível; as métricas continuam restritas às datas do período.
