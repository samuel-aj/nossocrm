/**
 * Tradução amigável (pt-BR) dos erros de envio do WhatsApp.
 *
 * A Meta devolve os motivos em inglês técnico ("131047 — Re-engagement
 * message — Message failed to send because more than 24 hours..."). Quem
 * atende no CRM precisa entender O QUE aconteceu e O QUE fazer, então o chat
 * mostra a explicação daqui e esconde o texto cru (fica só o código, pequeno,
 * pra suporte). Erros da Evolution (QR) também passam por aqui: sem código
 * conhecido, cai na mensagem genérica.
 */

const ERROS: Array<{ codes: string[]; msg: string }> = [
  {
    codes: ['131047', '131049'],
    msg:
      'Já se passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, agora só dá para falar com ele enviando um modelo aprovado (aba Modelos) ou esperando que ele mande uma nova mensagem.',
  },
  {
    codes: ['131026'],
    msg:
      'Este número não pode receber a mensagem. Ele pode estar sem WhatsApp ativo, ter bloqueado o seu número ou nunca ter aceitado os termos do WhatsApp.',
  },
  {
    codes: ['130472'],
    msg:
      'Este cliente não recebe mensagens de marketing pelo WhatsApp (preferência controlada pela Meta). Tente uma mensagem de atendimento ou outro canal.',
  },
  {
    codes: ['131048', '131056'],
    msg:
      'O WhatsApp limitou temporariamente os envios deste número por volume alto de mensagens em pouco tempo. Aguarde alguns minutos e tente de novo.',
  },
  {
    codes: ['131021'],
    msg: 'Você está tentando enviar uma mensagem para o próprio número conectado ao CRM.',
  },
  {
    codes: ['131051'],
    msg: 'Este tipo de mensagem não é aceito pelo WhatsApp. Tente enviar como texto ou outro formato de arquivo.',
  },
  {
    codes: ['131052', '131053'],
    msg: 'Não foi possível enviar o arquivo. Tente novamente com outro formato ou um arquivo menor.',
  },
  {
    codes: ['132000'],
    msg:
      'O modelo foi enviado com campos diferentes do que a Meta aprovou. Confira as variáveis do modelo na aba Modelos.',
  },
  {
    codes: ['132001'],
    msg: 'O modelo não existe ou ainda não foi aprovado nesse idioma. Confira na aba Modelos.',
  },
  {
    codes: ['132015', '132016'],
    msg: 'Este modelo foi pausado ou desativado pela Meta (geralmente por avaliações negativas). Use outro modelo.',
  },
  {
    codes: ['131042'],
    msg:
      'Há um problema de pagamento na conta da Meta deste número (método de cobrança). É preciso resolver no Gerenciador de Negócios da Meta.',
  },
  {
    codes: ['133010', '131045'],
    msg:
      'O número conectado está com problema de registro na Meta. Vá em WhatsApp, Conexão e reconecte o número.',
  },
  {
    codes: ['368', '131031'],
    msg:
      'A Meta suspendeu temporariamente este número por suspeita de violação das políticas do WhatsApp. Verifique o Gerenciador de Negócios da Meta.',
  },
  {
    codes: ['131000', '131016', '500'],
    msg: 'O WhatsApp teve uma falha interna e não entregou a mensagem. Tente de novo em instantes.',
  },
  {
    codes: ['100'],
    msg: 'O WhatsApp rejeitou os dados do envio. Tente de novo; se persistir, verifique o número do contato.',
  },
];

/** Traduz o erro cru do provedor pra uma explicação em pt-BR + código técnico. */
export function traduzErroWhatsApp(raw: string): { explicacao: string; codigo: string | null } {
  const texto = (raw || '').trim();
  const codigo = texto.match(/\b(\d{3,6})\b/)?.[1] ?? null;

  if (codigo) {
    const hit = ERROS.find(e => e.codes.includes(codigo));
    if (hit) return { explicacao: hit.msg, codigo };
  }
  // Sem código mapeado: mensagem honesta e acionável, sem o inglês técnico.
  return {
    explicacao:
      'O WhatsApp não entregou a mensagem. Tente de novo em instantes; se continuar, verifique a conexão do número na tela Conexão.',
    codigo,
  };
}
