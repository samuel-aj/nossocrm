'use client';

import { useEffect } from 'react';
import { isStaleChunkError, tryAutoReload } from '@/components/pwa/ChunkErrorReload';

/**
 * Tela de erro global (substitui o "Application error: a client-side
 * exception..." padrão do Next, em inglês). Erro de chunk desatualizado
 * (aba aberta antes de um deploy) recarrega sozinho pra versão nova; os
 * demais mostram uma tela em português com botão de recarregar.
 *
 * Obs.: este componente renderiza <html>/<body> próprios (exigência do
 * global-error) e não herda o CSS do app — por isso os estilos inline.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const staleChunk = isStaleChunkError(error?.message);
  useEffect(() => {
    if (isStaleChunkError(error?.message)) {
      tryAutoReload();
    }
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{staleChunk ? 'Precisamos recarregar esta aba' : 'Não foi possível abrir esta tela'}</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '0 0 20px', lineHeight: 1.6 }}>
            {staleChunk
              ? 'Não foi possível carregar um arquivo do sistema. Recarregue para tentar novamente com a versão atual.'
              : 'Ocorreu um erro ao carregar o CRM. Tente recarregar a página. Se continuar, informe o problema pelo suporte.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '12px 24px',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Recarregar agora
          </button>
        </div>
      </body>
    </html>
  );
}
