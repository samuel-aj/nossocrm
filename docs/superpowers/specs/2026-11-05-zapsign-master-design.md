# ZapSign — configuração pelo Administrador Mestre

Autorizado por Samuel: “Faz esse ajuste então. Coloca isso somente para o administrador Mestre”.

A aba de configuração da ZapSign e os endpoints GET, PUT e DELETE de settings devem aceitar o Administrador Mestre da organização da sessão. Superadministradores preservam o acesso existente. Administradores comuns e vendedores não recebem esse acesso. O Mestre é identificado pela configuração de equipe existente, nunca por nome, e-mail ou pelo simples papel admin.

Reusar a consulta de permissões da equipe na tela e no servidor. Falha na leitura de permissões deve bloquear o acesso. O servidor deve consultar a organização autenticada em cada requisição, inclusive para impedir que um antigo Mestre continue usando uma aba aberta após transferência da função. A aba não deve renderizar enquanto as permissões não estiverem confirmadas.

Sem migração, troca de cargo, alteração de token, criação de contrato ou mensagem real. O uso operacional de contratos no lead permanece como está. Implementação isolada sobre main d701620 para preservar as atualizações recentes. Publicação não faz parte desta alteração local.

Critérios: Mestre vê e administra configuração; admin comum não vê e recebe 403 ao acessar diretamente; superadministrador mantém acesso; vendedor e usuário não autenticado são negados; falha na consulta não revela configuração; troca de organização/função não reutiliza autorização anterior. Testes com banco e ZapSign simulados.
