export type SuggestionStatus = 'pending' | 'done' | 'discarded';

export interface Suggestion {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  /** Nome de exibicao do autor, montado no servidor. */
  author_name: string;
  organization_id: string;
  /** Nome do cliente (organização) de onde veio a sugestão — usado na visão global do super_admin. */
  organization_name?: string | null;
  /** Status definido pelo super_admin: pendente, feito ou descartado. */
  status: SuggestionStatus;
}
