# Criação de grupos: número e elegibilidade

Escopo aprovado pelo usuário em 14/10/2026 após diagnóstico: mostrar sempre o número usado, diferenciar conexão oficial de QR Code e explicar em português a recusa de elegibilidade da Meta.

- O modal lista as conexões ativas com número e tipo. Respeita o filtro atual; sem filtro usa a conexão do chat. Sem contexto inequívoco, exige seleção em vez de escolher outro número silenciosamente.
- QR Code mostra orientação para criar no celular e aguardar sincronização; não chama a API de criação da Meta. Outros provedores não suportados também não chamam essa API.
- API oficial informa previamente que a criação depende de habilitação pela Meta. Não presumir elegibilidade apenas porque a conexão está ativa.
- A recusa conhecida retorna código GROUPS_NOT_ELIGIBLE, mensagem em português e HTTP 422. O modal mantém o nome preenchido e o erro visível; impede repetir a mesma tentativa enquanto o erro estiver selecionado. Trocar a conexão limpa o erro.
- Nenhuma alteração em permissões, banco, provedores ou sincronização. Sem grupos reais nem mensagens nos testes. Publicação exige autorização específica para esta correção.

Validação: requisições simuladas, testes da página cobrindo número único/múltiplos/filtro/QR/recusa/sucesso e testes do serviço/rota garantindo ausência de persistência após recusa.
