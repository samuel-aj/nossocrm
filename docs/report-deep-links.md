# Abertura de leads a partir dos relatórios

O link `/boards?deal=<id>` sofria uma corrida na montagem: o efeito que recebia o ID da URL marcava a inicialização como concluída, mas o efeito seguinte ainda via a seleção anterior (null) e executava `router.replace('?')`. Isso podia apagar o destino antes de o lead abrir. A sincronização antiga também ignorava mudanças posteriores de link.

A seleção agora nasce do parâmetro da URL e acompanha a navegação. A URL só é reescrita por ações explícitas de abrir/fechar. Parâmetros alheios ao lead são preservados. O controller resolve o ID pela query de detalhes existente, independente dos filtros e da lista do board, e seleciona o board do lead quando ele pertence aos boards acessíveis. Os filtros salvos permanecem intactos.

O modal apresenta carregamento enquanto resolve o ID e, em caso de erro ou ausência, informa a falha e oferece tentar novamente/fechar. Nenhuma migração ou alteração em registros de leads é necessária.

Validação: o código anterior reproduziu o apagamento da URL nos testes. A correção passou em 44 testes de relatório, URL, controller e modal, incluindo montagem em StrictMode, parâmetros carregados depois da montagem, fechar/reabrir, navegação entre links, filtros ativos, outro board salvo, cache vazio, resolução tardia e erro de consulta. Typecheck e lint dos arquivos alterados passaram. O navegador conectado não estava disponível para verificação visual autenticada.
