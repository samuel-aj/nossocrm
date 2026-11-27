# Monitor do AgentMaker

Uma chave de operador conecta o Monitor do Paperclip aos agentes de vários escritórios pelo mesmo endpoint MCP do CRM.

1. No CRM, entre em **Super Admin → Chaves de operador da AJ**. Informe um nome que identifique o conector e clique em **Criar chave de leitura**.
2. Copie o segredo antes de concluir ou fechar a seção. No Paperclip, configure um conector MCP HTTP para o caminho `/api/mcp` do domínio do CRM. Armazene a chave no campo de credencial para autenticação Bearer. Conceda a conexão ao Monitor.
3. Confira as seis ferramentas em `tools/list`. A ferramenta `crm.ai_agents.list` retorna organização, agente e estado do monitoramento. As outras cinco consultam roteiro, conversas, transcrição e versões quando **Monitorar com o squad** estiver ligado. Esse interruptor continua sob controle humano no CRM.
4. Para interromper o acesso, revogue a chave na mesma seção do Super Admin. A próxima chamada já exige uma chave ativa. Para trocar a credencial, crie outra, atualize o segredo no conector e revogue a anterior.

O catálogo inclui os agentes com monitoramento desligado dos escritórios ativos que têm o recurso de agentes habilitado. Cada página de conteúdo verifica novamente o escritório e o monitoramento. Para consultar uma conversa, ela precisa estar vinculada ao agente e ter uma execução real bem-sucedida dele. O Monitor omite conversas com registros de outro agente ou com saída pela API externa, pois o CRM não consegue atribuir todo o histórico ao mesmo agente nesses casos. Para um roteiro sem revisões, a consulta apresenta a versão inicial diretamente a partir do texto cadastrado.

**Auditoria.** A tela mostra o último uso da chave. O registro privado `aj_operator_audit` identifica a ferramenta, o resultado, a chave e as organizações consultadas. As organizações de uma mesma página do catálogo compartilham o identificador de chamada. O registro guarda metadados de acesso, sem o conteúdo lido ou o segredo.

**Validação local.** Rode `node scripts/test-mcp-operator-db.mjs "<pasta bin do PostgreSQL>"`, informando a pasta que contém `initdb` e `pg_ctl`. O teste cria um cluster temporário local, aplica a migração, executa o rollback e reaplica a migração. Rode também `npx vitest run --config vitest.mcp.config.ts` para verificar as rotas e a tela do Super Admin.

**Publicação.** Com autorização, aplique a migração aditiva `20261127203007_aj_operator_keys.sql` antes de liberar a versão da aplicação. O [rollback](aj-operator-keys-rollback.sql) retira as chaves de operador e preserva a auditoria.
