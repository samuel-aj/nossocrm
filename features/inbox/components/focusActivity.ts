/**
 * Negócio fictício do modo Foco da Inbox.
 *
 * Para um contato sem lead, o painel de contexto abre com um negócio que só
 * existe na tela, com este prefixo no id. Esse id não existe no banco: o
 * registro de atividade feito a partir dele sai sem negócio.
 */
export const PLACEHOLDER_DEAL_PREFIX = 'placeholder-';

/** Diz se o id é o de um negócio fictício do modo Foco. */
export const isPlaceholderDealId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith(PLACEHOLDER_DEAL_PREFIX);

/**
 * Prepara a atividade registrada no painel de contexto para ser gravada.
 *
 * Feita a partir do negócio fictício, ela sai sem negócio (id vazio), que é o
 * que o banco sempre recebeu nesse caso. Com negócio real, nada muda.
 */
export function activityForFocusDeal<T extends { dealId?: string }>(activity: T): T {
  return isPlaceholderDealId(activity.dealId) ? { ...activity, dealId: '' } : activity;
}
