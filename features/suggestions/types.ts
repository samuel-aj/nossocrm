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
  votes_count: number;
  /** Se o usuario logado ja votou nesta sugestao. */
  voted_by_me: boolean;
}
