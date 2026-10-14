# WhatsApp pelo MCP

Escopo aprovado em 14/10/2026: implementação, testes locais, aplicação da migração e publicação do MCP. Validação em produção somente por consultas. Nenhum envio real, especialmente ao grupo Thiago Servilha.

O MCP autentica a chave e seu proprietário, verifica vínculo atual à organização e aplica as mesmas regras de conexão/conversa do chat. Consultas retornam IDs e número da conexão, nunca credenciais. Envio exige IDs explícitos da conversa e da conexão.

O serviço de envio do chat passa a aceitar um contexto autenticado sem cookies. Despacho e gravação no histórico são compartilhados com a API pública. Uma sequência persistente mantém o conteúdo exato e um identificador único por item. Uma operação com o mesmo identificador e conteúdo retorna o resultado anterior; conteúdo diferente é conflito.

Estados: pending → preparing (lease recuperável) → dispatching (não reenviável) → accepted → completed. O despacho é registrado antes da chamada externa; resultado/ID do provedor são persistidos antes do histórico. Somente pending ou preparing expirado podem iniciar um despacho. Timeout/erro após dispatching interrompe a sequência. Reconciliação usa IDs do provedor/histórico; nunca adivinha por texto ou horário. A retomada não repete itens aceitos e não promete exactly-once.

PDF: manifesto com tamanho e SHA-256, upload assinado sem sobrescrita no bucket privado wa-media, validação dos bytes e cópia selada privada. A ferramenta recebe attachmentId, nunca caminho local ou URL arbitrária. Script local transfere bytes ao Storage. Limite de 10 MiB; texto até 4096 caracteres por item, legenda até 1024; nenhum truncamento/divisão automática.

Transporte Streamable HTTP stateless, JSON UTF-8, negociação de versão, notificações 202 e GET/DELETE 405. Teste com cliente oficial SDK e provedores simulados. Banco isolado verifica exclusão mútua, retomada e acesso negado.
