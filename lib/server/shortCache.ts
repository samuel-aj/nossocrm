/**
 * Cache curto em memória da instância do servidor (a Vercel reaproveita a
 * instância entre requisições). Junta pedidos simultâneos da mesma chave numa
 * consulta só e guarda o resultado por poucos segundos.
 *
 * Feito para leituras que toda rota repete e que podem atrasar alguns segundos
 * (permissões da equipe, regras de visibilidade). Nunca para dado de login ou
 * de organização ativa. Desligado nos testes, que montam um banco falso por
 * teste. Quem recebe o valor não deve alterá-lo (é compartilhado).
 */
export function createShortCache<V>(ttlMs: number, maxEntries = 2000) {
  const store = new Map<string, { at: number; value: Promise<V> }>();
  const enabled = !process.env.VITEST;
  return {
    get(key: string, load: () => Promise<V>): Promise<V> {
      if (!enabled) return load();
      const now = Date.now();
      const hit = store.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;
      const value = load();
      store.set(key, { at: now, value });
      // Erro não fica guardado: a próxima chamada tenta de novo
      value.catch(() => {
        if (store.get(key)?.value === value) store.delete(key);
      });
      if (store.size > maxEntries) store.delete(store.keys().next().value as string);
      return value;
    },
    /** Esquece as chaves que começam com o prefixo (ou tudo, sem prefixo). */
    forget(prefix?: string): void {
      if (!prefix) return store.clear();
      for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
    },
  };
}
