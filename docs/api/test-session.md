# Sessões do simulador de agentes

`POST /api/wa-agents/agents/{id}/test` simula uma resposta, sem enviar mensagem ou criar contrato real.

Use um UUID em `sessionId` e repita esse ID em todas as chamadas que representem o mesmo cliente fictício. A resposta devolve `sessionId`. Para começar outro teste independente, gere outro UUID. Se o campo for omitido, o servidor gera e retorna um ID novo, preservando a compatibilidade com chamadas existentes; devolva esse ID no próximo POST.

```json
{
  "sessionId": "de5b224b-8364-4f99-98b2-73320df2a372",
  "messages": [{ "role": "user", "text": "Meu nome é Maria" }]
}
```

As mídias aceitas ficam registradas no servidor, separadas de conversas reais e isoladas por escritório, usuário autenticado, agente e sessão. O bloqueio funciona mesmo quando a próxima chamada não inclui `messages[].media`. Para manter o contexto da conversa, continue enviando o histórico em `messages` e os dados da ficha em `state`; a sessão não armazena nem recompõe esse conteúdo.

A opção de enviar a mídia uma única vez vale por toda a sessão, sem expirar em um minuto. Quando essa opção está desligada, a mesma mídia pode reaparecer após 60 segundos da resposta anterior. Chamadas concorrentes não podem aceitar o mesmo arquivo. Renomear o arquivo não remove o bloqueio.

Falha conhecida de geração ou bloqueio de segurança libera somente as reservas daquela tentativa. Interrupções sem resultado confirmado mantêm a reserva por segurança; use **Limpar** ou um novo `sessionId` para reiniciar esse teste. Uma resposta perdida na rede não deve ser interpretada como mídia não gerada.

Na tela **Testar**, a sessão é mantida ao fechar e reabrir o painel e muda ao clicar em **Limpar**. A prévia de voz (`previewVoice`) continua independente desse mecanismo. Não use um ID de conversa real como substituto da sessão de teste.
