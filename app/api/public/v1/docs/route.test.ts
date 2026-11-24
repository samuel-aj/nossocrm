import { describe, expect, it } from 'vitest';
import { GET } from './route';

async function render(query: string): Promise<string> {
  const res = await GET(new Request(`https://crm.test/api/public/v1/docs${query}`));
  expect(res.status).toBe(200);
  return res.text();
}

describe('GET /api/public/v1/docs', () => {
  it('ignora spec que tenta fechar a tag <script> (XSS refletido)', async () => {
    const payload = encodeURIComponent('</script><script>alert(document.cookie)</script>');
    const html = await render(`?spec=${payload}`);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('url: "/api/public/v1/openapi.json"');
  });

  it('ignora spec de outro site', async () => {
    const html = await render(`?spec=${encodeURIComponent('https://evil.example/spec.json')}`);
    expect(html).not.toContain('evil.example');
    expect(html).toContain('url: "/api/public/v1/openapi.json"');
  });

  it('aceita caminho da própria API pública', async () => {
    const html = await render('?spec=/api/public/v1/openapi.json');
    expect(html).toContain('url: "/api/public/v1/openapi.json"');
  });

  it('carrega o Swagger com versão fixa e assinatura (SRI)', async () => {
    const html = await render('');
    expect(html).not.toContain('swagger-ui-dist@5/');
    expect(html.match(/integrity="sha384-/g)?.length).toBe(3);
  });
});
