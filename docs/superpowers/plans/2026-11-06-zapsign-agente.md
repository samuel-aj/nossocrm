# ZapSign no atendimento do agente

**Objetivo:** o escritório habilita um modelo específico no agente. O agente coleta os dados, apresenta o resumo e cria pelo modelo após a confirmação do cliente, sem disparar o convite. O fluxo humano e suas conferências continuam disponíveis.

**Base:** main 686411d; a aba Contrato já preenche variáveis com auxílio de IA. O motor de atendimento ainda não possui ferramenta de criação.

1. Em `features/wa-agents/AgentEditor.tsx` e `lib/wa-agents/types.ts`, incluir o modelo opcional nos recursos do agente. Sem seleção, não oferecer a ferramenta.
2. Compartilhar leitura das variáveis do DOCX com a rota de modelos. Usar a conexão da organização, valores do CRM e informações pessoais comprovadas na conversa. Apresentar resumo com referência do modelo, lead e valores; exigir resposta afirmativa a esse resumo.
3. Registrar a criação em `deal_signatures` com origem própria, reserva única por escritório/lead/modelo e sem retentativa automática. Associar webhook autenticado por referência externa caso a resposta da criação se perca.
4. Ligar o motor a esse serviço e o painel Testar a um provedor simulado sem acesso de escrita. Documentar uso e limites.
5. Rodar testes isolados de ferramenta, contratos manuais, confirmação, mudança de valores, concorrência, timeout e autorização. Nenhum POST externo, migração de produção ou publicação nesta etapa.
