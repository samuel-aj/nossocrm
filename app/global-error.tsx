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
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>O CRM foi atualizado</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '0 0 20px', lineHeight: 1.6 }}>
            Esta aba estava com uma versão antiga do sistema. Recarregue para
            continuar de onde parou.
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
