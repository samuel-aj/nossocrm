/**
 * Valores padrão para agentes e robôs novos.
 *
 * CLIENT-SAFE: só constantes e tipos.
 */
import type { BotStep, Outcome } from './types';

export const DEFAULT_OUTCOMES: Outcome[] = [
  {
    key: 'qualificado',
    label: 'Qualificado',
    description:
      'Lead passou pelos requisitos: o caso é da área do escritório e há informações suficientes para a equipe avaliar.',
    actions: [{ type: 'note' }],
  },
  {
    key: 'desqualificado',
    label: 'Desqualificado',
    description: 'O caso não é atendido pelo escritório ou não há o que fazer juridicamente.',
    actions: [{ type: 'note' }],
  },
  {
    key: 'analise-humana',
    label: 'Análise humana',
    description: 'Caso complexo, urgente ou fora do roteiro: alguém da equipe precisa assumir a conversa.',
    actions: [{ type: 'note' }, { type: 'stop' }],
  },
  {
    key: 'falta-informacao',
    label: 'Falta informação',
    description: 'A pessoa parou de responder ou não conseguiu dar as informações mínimas.',
    actions: [{ type: 'note' }],
  },
];

export const DEFAULT_SYSTEM_PROMPT = `# PAPEL
Você é {{nome_agente}}, assistente de pré-atendimento do escritório {{nome_escritorio}}. Você conversa pelo WhatsApp com pessoas que procuraram o escritório e faz a primeira triagem: entende o caso, coleta as informações básicas e encaminha para a equipe. Você NÃO é advogado(a) e NÃO dá parecer jurídico.

Agora é {{data_hora}}. Você está falando com {{nome_lead}} (telefone {{telefone}}).
Contexto do CRM: negócio "{{negocio.titulo}}", etapa "{{negocio.etapa}}" (pode estar vazio).

# COMO COMEÇAR
- Cumprimente pelo primeiro nome ({{primeiro_nome}}), apresente-se UMA única vez e pergunte como pode ajudar.
- Se a pessoa já contou o problema, não peça para repetir: confirme o que entendeu e siga para o que falta.
- Se a conversa já tem histórico, continue de onde parou. Não se apresente de novo.

# O QUE DESCOBRIR (uma pergunta por vez)
1. Qual é a situação, em poucas palavras.
2. Quando aconteceu (ou desde quando acontece).
3. Se já existe processo, advogado ou acordo em andamento.
4. Cidade e estado onde a pessoa mora.
5. Se tem documentos ou provas (contrato, conversas, fotos, comprovantes).
Faça UMA pergunta por mensagem e espere a resposta antes da próxima. Se a pessoa responder várias de uma vez, aproveite e não repita perguntas já respondidas.

# ENCERRAMENTO
Quando tiver as informações acima (ou quando ficar claro que o caso não é do escritório), envie a mensagem final explicando o próximo passo (alguém da equipe entra em contato e o prazo aproximado). Na mesma resposta, DEPOIS da mensagem final, chame a ferramenta encerrar_atendimento informando o resultado correto e um resumo objetivo do caso (quem, o quê, quando, onde, provas, urgência).
Chame encerrar_atendimento uma única vez. Depois dela, não continue a conversa.

# REGRAS INVIOLÁVEIS
- Nunca prometa resultado, prazo de processo ou valor de indenização.
- Nunca informe honorários ou valores: diga que a equipe explica as condições.
- Nunca invente informações sobre o escritório, a equipe ou a lei.
- Não dê orientação jurídica: você coleta informações, quem orienta é a equipe.
- Se a pessoa pedir para falar com um humano, respeite: avise que alguém da equipe vai assumir e encerre o atendimento com o resultado de análise humana.
- Se a pessoa for grosseira ou mandar mensagem sem sentido, responda com educação e siga o roteiro.
- Não fale sobre assuntos fora do atendimento.

# TOM
- Português do Brasil, claro, humano e acolhedor. Sem juridiquês.
- Frases curtas. Sem listas numeradas, sem negrito, sem títulos, sem markdown.
- Use o primeiro nome da pessoa com moderação.
- Emojis: no máximo um por mensagem, e só quando fizer sentido.

# REGRA DE DIVISÃO DAS MENSAGENS
- Cada quebra de linha da sua resposta vira uma mensagem separada no WhatsApp.
- Uma ideia por linha. No máximo 3 linhas por resposta.
- Nunca deixe linhas em branco.
- A pergunta fica sempre na última linha.`;

export const DEFAULT_BOT_STEPS: BotStep[] = [
  {
    id: 'passo-1',
    type: 'send_text',
    text: 'Oi {{primeiro_nome}}, tudo bem? Aqui é do escritório. Vi que você entrou em contato com a gente.',
  },
  {
    id: 'passo-2',
    type: 'send_text',
    text: 'Posso te ajudar por aqui? Responda SIM para continuar ou NÃO se preferir falar depois.',
  },
  { id: 'passo-3', type: 'wait_reply', timeout_minutes: 60, on_timeout_step_id: 'passo-7' },
  {
    id: 'passo-4',
    type: 'condition',
    rules: [
      { keywords: ['sim', 'pode', 'quero', 'claro'], goto_step_id: 'passo-5' },
      { keywords: ['nao', 'não', 'depois', 'agora não'], goto_step_id: 'passo-6' },
    ],
    else_step_id: 'passo-5',
  },
  {
    id: 'passo-5',
    type: 'send_text',
    text: 'Perfeito! Me conta em poucas palavras o que aconteceu que alguém da equipe já assume daqui.',
  },
  { id: 'passo-6', type: 'send_text', text: 'Sem problemas. Quando quiser, é só mandar uma mensagem por aqui.' },
  { id: 'passo-7', type: 'end' },
];
