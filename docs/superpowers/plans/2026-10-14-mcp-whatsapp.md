# MCP WhatsApp — plano de implementação

**Objetivo:** consultas, PDFs e sequências pelo MCP existente, preservando histórico e permissões.
**Execução:** implementação local concluída. Migração e publicação autorizadas em 14/10/2026; validação em produção somente por consultas, sem mensagens reais.

- [x] Extrair lib/whatsapp/sendMessage.ts e lib/whatsapp/outbound.ts; preservar contratos UI/API.
- [x] Criar migração de operações, itens e uploads privados; validar atomicidade e fencing em PGlite.
- [x] Implementar lib/mcp/whatsapp: autenticação do proprietário, consultas, uploads, sequências, reconciliação e ferramentas.
- [x] Integrar registry e transporte app/api/mcp/route.ts sem cookies.
- [x] Criar scripts/mcp-upload-pdf.mjs e instruções concretas de configuração do Codex.
- [x] Testes com mocks: escopo, nomes duplicados, Unicode, PDF inválido, repetição, concorrência, timeout e falha parcial.
- [x] Cliente oficial MCP: initialize, listTools e callTool reais em servidor HTTP local com dependências simuladas.
- [x] Typecheck, lint, testes pertinentes e build; registrar limitações e passos de publicação.
