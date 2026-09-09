# Produtos nos webhooks de automações

O contexto do lead inclui `deal.items`, carregado de `deal_items` com filtros pelo negócio e pela organização. O campo acompanha o negócio após mudanças de pipeline.

Para enviar os produtos no corpo personalizado:

```json
{
  "deal_id": "{{deal.id}}",
  "items": {{deal.items}}
}
```

`items` é uma lista de `{ product_id, name, quantity, price }`. Itens personalizados têm `product_id: null`. Negócios sem itens enviam `[]`. Para preservar o tipo JSON, use `{{deal.items}}` sem aspas.

Corpos que usam variáveis entre aspas continuam recebendo strings escapadas. A falha de leitura dos produtos interrompe a execução em vez de enviar uma lista vazia incorreta.
