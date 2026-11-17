# Aviso quando a revisão da resposta falha

## Diagnóstico

Consulta somente leitura confirmou a execução `eea61abe-358a-49cf-b245-b866f4f8a900` de 16/11/2026 às 22:52:53 UTC (19:52 Brasília), na SGM. A saída foi bloqueada por `internal_marker` e a tentativa de revisão falhou. O CRM pausou a IA sem registrar o evento de análise humana que alimenta o sino. O texto bloqueado não foi armazenado: `output_text` nulo, apenas tamanho e motivo nos eventos. Não é possível reconstruí-lo com certeza.

A ferramenta de vídeo apenas preparou a mídia. Não houve mensagem enviada nessa execução. As ações de etapa e etiqueta eram intenções, ainda não aplicadas pelo motor. Não reenviar nem executar retroativamente essas intenções. A equipe já assumiu o caso.

## Correção

- Conservar o filtro e sua única tentativa de revisão. Nenhuma mudança no prompt salvo ou no modelo do agente.
- Quando a própria execução conseguir pausar a conversa, registrar `human_handoff` com causa `output_safety`. O trigger existente cria o aviso no sino para o responsável, seguindo permissões e preferências atuais. Não requer migração.
- Para resposta direta a mensagem recebida, enviar apenas o texto fixo: “Vou encaminhar seu atendimento para a equipe conferir uma informação e continuar por aqui.” Sem nova chamada de IA, ações, mídias ou rascunhos anteriores.
- Revalidar consumo, pausa exata, ausência de intervenção humana, agente, conexão, destinatário, lock vigente e mensagem de origem antes do transporte. Na API Meta, respeitar a janela. Follow-ups bloqueados avisam a equipe sem enviar essa resposta tardia.
- Manter a pausa sem horário de retomada. Falha de envio não remove a pausa/aviso e não gera nova tentativa de envio. Erros de consumo continuam sem mensagem ou webhook externo.
- Nas próximas execuções, registrar até três amostras de texto bloqueado (500 caracteres cada), fase e categoria fixa da falha. Somente no histórico restrito de execuções, nunca na conversa. Não copiar prompts, argumentos ou payloads do provedor para o diagnóstico.

O bloqueio conserva o comportamento existente das ferramentas: impede mídias e ações adiadas; não desfaz contratos ou agendamentos eventualmente executados durante a geração. O fallback não chama nenhuma dessas ferramentas.

## Verificação

Testes offline com banco, modelo e WhatsApp substituídos: fallback único, guarda antes do transporte, equipe concorrente, outra mensagem, mudança de agente/conexão, lock perdido, quota/ledger, janela Meta, falha incerta de transporte, diagnóstico limitado e regressão de revisão válida/simulador. Reutilizar testes existentes do feed e deduplicação do sino. Typecheck, lint dos arquivos alterados e build antes de concluir.

Nenhuma mensagem, contrato, alteração de atendimento ou prompt real nos testes. Publicação deste ajuste fica para autorização específica.

Validação concluída em 17/11/2026: 591 testes em 58 arquivos na suíte offline, mais um cenário de mídia enfileirada (43/43 testes do motor após esse acréscimo, total de 592 cenários distintos); typecheck, lint direcionado, build com 163 páginas e revisão independente aprovados.
