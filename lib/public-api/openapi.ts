// OpenAPI 3.1.2 "source of truth" for NossoCRM Public API (Integrations).
//
// NOTE:
// - Keep this file updated together with route implementations.
// - Prefer stable, integration-friendly shapes (simple objects, consistent errors).

export type OpenApiDocument = Record<string, any>;

export function getPublicApiOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.1.2',
    info: {
      title: 'NossoCRM Public API',
      version: 'v1',
      description: [
        'API pública do NossoCRM para integrações (n8n/Make). Produto em primeiro lugar: copiar → colar → testar.',
        '',
        '## Webhooks de saída (Follow-up)',
        'Em **Configurações → Integrações → Follow-up** você cadastra a URL do seu n8n/Make e marca os avisos:',
        '- `deal.stage_changed` — lead mudou de etapa',
        '- `whatsapp.message.received` — o lead mandou mensagem para um número conectado',
        '- `whatsapp.message.sent` — você respondeu (pelo CRM, pelo celular/Kommo ou por esta API)',
        '',
        'Cada aviso é um `POST` JSON com os headers `X-Webhook-Event`, `X-Webhook-Secret` e `Authorization: Bearer <secret>`.',
        'Payload das mensagens: `{ event_type, occurred_at, organization_id, message: { id, direction (in|out), status, text, media_type, media_mime, media_path, provider_message_id, source (inbound|echo|crm|api), sent_by_user_id, sent_by_name, timestamp }, conversation: { id, phone, name, contact_id, deal_id, assigned_owner_id }, connection: { id, phone_number, provider, name }, contact: { id, name, phone, email }, deal: { id, title, board_id, stage_id } }`.',
        'Para um agente de IA: use `conversation.phone` + `connection.id` como chave da memória e responda com `POST /whatsapp/messages` (a resposta chega com `source: "api"`, ignore-a no seu fluxo pra não responder a si mesmo).',
      ].join('\n'),
    },
    servers: [{ url: '/api/public/v1' }],
    tags: [
      { name: 'Meta', description: 'Sobre a API e autenticação' },
      { name: 'Boards', description: 'Pipelines/boards e etapas' },
      { name: 'Companies', description: 'Empresas (clientes do CRM)' },
      { name: 'Contacts', description: 'Contatos (leads/pessoas)' },
      { name: 'Deals', description: 'Negócios (cards)' },
      { name: 'Activities', description: 'Atividades (nota/tarefa/reunião/ligação)' },
      { name: 'Catálogo', description: 'Produtos e campos personalizados (IDs/keys para usar em deals)' },
      { name: 'WhatsApp', description: 'Enviar mensagens pelo WhatsApp conectado (texto ou modelo aprovado). Tudo fica registrado no chat do CRM.' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
          description: 'Chave gerada na interface (Settings → Integrações).',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          additionalProperties: false,
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
          required: ['error'],
        },
        PaginatedResponse: {
          type: 'object',
          additionalProperties: false,
          properties: {
            data: { type: 'array', items: {} },
            nextCursor: { type: 'string', nullable: true },
          },
          required: ['data'],
        },
        WhatsAppConnection: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'UUID da conexão (use em connection_id)' },
            phone_number: { type: ['string', 'null'], description: 'Número conectado (E.164)' },
            name: { type: ['string', 'null'], description: 'Nome do perfil/empresa no WhatsApp' },
            provider: { type: 'string', description: 'meta_cloud (API oficial) | evolution (QR) | evolution_business' },
            status: { type: 'string', description: 'connected | connecting | disconnected' },
            official_api: { type: 'boolean' },
            supports_templates: { type: 'boolean', description: 'true só na API oficial' },
          },
          required: ['id', 'provider', 'status'],
        },
        WhatsAppSendRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            to: { type: 'string', description: 'Telefone do destinatário (E.164 ou só dígitos, ex.: 5569999999999)' },
            text: { type: 'string', description: 'Texto da mensagem (dentro da janela de 24h)' },
            template: {
              type: 'object',
              description: 'Modelo aprovado na Meta (só API oficial). Obrigatório fora da janela de 24h.',
              properties: {
                name: { type: 'string' },
                language: { type: 'string', description: 'Padrão pt_BR' },
                params: { type: 'array', items: { type: 'string' }, description: 'Valores de {{1}}, {{2}}... do corpo, em ordem' },
                components: { type: 'array', items: { type: 'object' }, description: 'Formato completo da Meta (substitui params)' },
              },
              required: ['name'],
            },
            connection_id: { type: 'string', description: 'Qual número envia (GET /whatsapp/connections). Omitido = padrão da org.' },
          },
          required: ['to'],
        },
        WhatsAppSendResponse: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            error_pt: { type: 'string', description: 'Explicação em português quando a Meta recusa' },
            code: { type: 'string' },
            message: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string', description: 'sent | failed' },
                provider_message_id: { type: ['string', 'null'] },
                conversation_id: { type: 'string' },
                connection_id: { type: 'string' },
                to: { type: 'string' },
              },
            },
          },
          required: ['ok'],
        },
        Board: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'UUID do board' },
            key: { type: ['string', 'null'], description: 'Slug estável (integrações)' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            position: { type: 'integer' },
            is_default: { type: 'boolean' },
          },
          required: ['id', 'key', 'name', 'description', 'position', 'is_default'],
        },
        BoardStage: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'UUID do estágio' },
            label: { type: 'string' },
            color: { type: ['string', 'null'] },
            order: { type: 'integer' },
          },
          required: ['id', 'label', 'color', 'order'],
        },
        Company: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            website: { type: ['string', 'null'] },
            industry: { type: ['string', 'null'] },
            created_at: { type: 'string' },
            updated_at: { type: ['string', 'null'] },
          },
          required: ['id', 'name', 'website', 'industry', 'created_at', 'updated_at'],
        },
        Contact: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] },
            role: { type: ['string', 'null'] },
            company_name: { type: ['string', 'null'] },
            client_company_id: { type: ['string', 'null'] },
            avatar: { type: ['string', 'null'] },
            source: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
            status: { type: ['string', 'null'] },
            stage: { type: ['string', 'null'] },
            birth_date: { type: ['string', 'null'] },
            last_interaction: { type: ['string', 'null'] },
            last_purchase_date: { type: ['string', 'null'] },
            total_value: { type: ['number', 'null'] },
            created_at: { type: 'string' },
            updated_at: { type: ['string', 'null'] },
          },
          required: [
            'id',
            'name',
            'email',
            'phone',
            'role',
            'company_name',
            'client_company_id',
            'avatar',
            'source',
            'notes',
            'status',
            'stage',
            'birth_date',
            'last_interaction',
            'last_purchase_date',
            'total_value',
            'created_at',
            'updated_at',
          ],
        },
        Deal: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            value: { type: 'number' },
            board_id: { type: 'string' },
            stage_id: { type: 'string' },
            contact_id: { type: 'string' },
            owner_id: { type: ['string', 'null'], description: 'UUID do usuário RESPONSÁVEL pelo lead (null = sem responsável)' },
            client_company_id: { type: ['string', 'null'] },
            is_won: { type: 'boolean' },
            is_lost: { type: 'boolean' },
            loss_reason: { type: ['string', 'null'] },
            closed_at: { type: ['string', 'null'] },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags do deal' },
            custom_fields: { type: 'object', additionalProperties: true, description: 'Campos personalizados (JSONB)' },
            probability: { type: 'integer', minimum: 0, maximum: 100, description: 'Probabilidade de ganho (0-100)' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Prioridade' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
          },
          required: ['id', 'title', 'value', 'board_id', 'stage_id', 'contact_id', 'client_company_id', 'is_won', 'is_lost', 'loss_reason', 'closed_at', 'tags', 'custom_fields', 'probability', 'priority', 'created_at', 'updated_at'],
        },
        DealNote: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
          },
          required: ['id', 'content', 'created_at', 'updated_at'],
        },
        DealItem: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            product_id: { type: ['string', 'null'] },
            name: { type: 'string' },
            quantity: { type: 'integer' },
            price: { type: 'number' },
            created_at: { type: 'string' },
          },
          required: ['id', 'product_id', 'name', 'quantity', 'price', 'created_at'],
        },
        Activity: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            type: { type: 'string' },
            date: { type: 'string' },
            completed: { type: 'boolean' },
            deal_id: { type: ['string', 'null'] },
            contact_id: { type: ['string', 'null'] },
            client_company_id: { type: ['string', 'null'] },
            created_at: { type: 'string' },
          },
          required: ['id', 'title', 'description', 'type', 'date', 'completed', 'deal_id', 'contact_id', 'client_company_id', 'created_at'],
        },
        Product: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'UUID do produto (use em product_id ao criar deal)' },
            name: { type: 'string' },
            price: { type: 'number' },
            description: { type: ['string', 'null'] },
            sku: { type: ['string', 'null'] },
          },
          required: ['id', 'name', 'price'],
        },
        CustomFieldDefinition: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'UUID da definição' },
            key: { type: 'string', description: 'Chave estável — use como chave em custom_fields ao criar deal' },
            label: { type: 'string' },
            type: { type: 'string', enum: ['text', 'number', 'date', 'select', 'multiselect', 'currency'] },
            options: { type: ['array', 'null'], items: { type: 'string' } },
            entity_type: { type: 'string', description: 'Entidade do campo (ex: deal)' },
          },
          required: ['id', 'key', 'label', 'type'],
        },
      },
      responses: {
        Unauthorized: {
          description: 'API key ausente ou inválida',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              examples: {
                missing: { value: { error: 'Missing X-Api-Key', code: 'AUTH_MISSING' } },
                invalid: { value: { error: 'Invalid API key', code: 'AUTH_INVALID' } },
              },
            },
          },
        },
      },
    },
    paths: {
      '/openapi.json': {
        get: {
          tags: ['Meta'],
          summary: 'OpenAPI document (JSON)',
          description: 'Documento OpenAPI 3.1.2 desta API.',
          responses: {
            200: {
              description: 'OpenAPI document',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      // Endpoints below will be implemented next and MUST be kept in sync:
      '/me': {
        get: {
          tags: ['Meta'],
          summary: 'Identidade da API key',
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          organization_id: { type: 'string' },
                          organization_name: { type: 'string' },
                          api_key_prefix: { type: 'string' },
                        },
                        required: ['organization_id', 'organization_name', 'api_key_prefix'],
                      },
                    },
                    required: ['data'],
                    additionalProperties: false,
                  },
                  examples: {
                    ok: {
                      value: {
                        data: {
                          organization_id: '00000000-0000-0000-0000-000000000000',
                          organization_name: 'Minha Empresa',
                          api_key_prefix: 'ncrm_abc123',
                        },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/products': {
        get: {
          tags: ['Catálogo'],
          summary: 'Listar produtos do catálogo',
          description: 'Retorna os produtos ativos da organização. Use o `id` no campo `product_id` ao criar um deal.',
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/whatsapp/connections': {
        get: {
          tags: ['WhatsApp'],
          summary: 'Listar números de WhatsApp conectados',
          description: 'Use o `id` em `connection_id` ao enviar quando a organização tem mais de um número.',
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { data: { type: 'array', items: { $ref: '#/components/schemas/WhatsAppConnection' } } },
                    required: ['data'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/whatsapp/messages': {
        post: {
          tags: ['WhatsApp'],
          summary: 'Enviar mensagem de WhatsApp (texto ou modelo)',
          description:
            'Envia pelo número conectado e grava no chat do CRM (card do lead e /chats). Feito para agentes de IA no n8n/Make: receba as mensagens pelo webhook de saída e responda por aqui. Texto só funciona dentro da janela de 24h desde a última mensagem do lead; fora dela use `template`.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WhatsAppSendRequest' },
                examples: {
                  texto: { value: { to: '+5569999999999', text: 'Olá! Aqui é a equipe do escritório.' } },
                  modelo: { value: { to: '+5569999999999', template: { name: 'boas_vindas', language: 'pt_BR', params: ['Maria'] } } },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Enviada',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/WhatsAppSendResponse' } } },
            },
            400: { description: 'Corpo inválido / modelo em conexão sem API oficial', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { description: 'Nenhum número conectado / connection_id inexistente', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            409: { description: 'Número desconectado', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: {
              description: 'O provedor recusou o envio (a mensagem fica registrada como falha)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/WhatsAppSendResponse' } } },
            },
          },
        },
      },
      '/custom-fields': {
        get: {
          tags: ['Catálogo'],
          summary: 'Listar campos personalizados',
          description: 'Retorna as definições de campos personalizados da organização. Use a `key` como chave no objeto `custom_fields` ao criar um deal.',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'entity_type', in: 'query', schema: { type: 'string' }, description: 'Filtra por entidade (ex: deal)' },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/CustomFieldDefinition' } },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/boards': {
        get: {
          tags: ['Boards'],
          summary: 'Listar boards (pipelines)',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Busca por name/key' },
            { name: 'key', in: 'query', schema: { type: 'string' }, description: 'Filtro exato por key' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 }, description: 'Tamanho da página' },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Cursor opaco' },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Board' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/boards/{boardKeyOrId}': {
        get: {
          tags: ['Boards'],
          summary: 'Obter board por key ou id',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'boardKeyOrId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { data: { $ref: '#/components/schemas/Board' } },
                    required: ['data'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/boards/{boardKeyOrId}/stages': {
        get: {
          tags: ['Boards'],
          summary: 'Listar etapas do board',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'boardKeyOrId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/BoardStage' } },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/companies': {
        get: {
          tags: ['Companies'],
          summary: 'Listar empresas',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'name', in: 'query', schema: { type: 'string' } },
            { name: 'website', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Company' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Companies'],
          summary: 'Criar/atualizar empresa (upsert)',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    website: { type: 'string' },
                    industry: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/companies/{companyId}': {
        get: {
          tags: ['Companies'],
          summary: 'Obter empresa',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'companyId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Company' } }, required: ['data'] } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        patch: {
          tags: ['Companies'],
          summary: 'Atualizar empresa',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'companyId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/contacts': {
        get: {
          tags: ['Contacts'],
          summary: 'Listar contatos',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'email', in: 'query', schema: { type: 'string' } },
            { name: 'phone', in: 'query', schema: { type: 'string' } },
            { name: 'client_company_id', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Contacts'],
          summary: 'Criar/atualizar contato (upsert)',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    role: { type: 'string' },
                    company_name: { type: 'string', description: 'Nome da empresa (auto-cria/vincula em crm_companies quando client_company_id não é enviado)' },
                    client_company_id: { type: 'string' },
                    avatar: { type: 'string' },
                    status: { type: 'string' },
                    stage: { type: 'string' },
                    birth_date: { type: 'string', description: 'YYYY-MM-DD' },
                    last_interaction: { type: 'string', description: 'ISO timestamp' },
                    last_purchase_date: { type: 'string', description: 'YYYY-MM-DD' },
                    total_value: { type: 'number' },
                    source: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } },
            200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/contacts/{contactId}': {
        get: {
          tags: ['Contacts'],
          summary: 'Obter contato',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Contact' } }, required: ['data'] } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        patch: {
          tags: ['Contacts'],
          summary: 'Atualizar contato',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/deals': {
        get: {
          tags: ['Deals'],
          summary: 'Listar deals',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'board_id', in: 'query', schema: { type: 'string' } },
            { name: 'board_key', in: 'query', schema: { type: 'string' } },
            { name: 'stage_id', in: 'query', schema: { type: 'string' } },
            { name: 'contact_id', in: 'query', schema: { type: 'string' } },
            { name: 'client_company_id', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'won', 'lost'] } },
            { name: 'updated_after', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Deal' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Deals'],
          summary: 'Criar deal',
          description:
            'Cria um lead/negócio. Idempotente contra duplicados: se o contato já tem um negócio ABERTO no mesmo estágio (ou se o external_id já foi usado), responde 200 com o negócio existente (action: "existing") em vez de erro — integrações (n8n etc.) não quebram em reenvio.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string', minLength: 1 },
                    description: { type: 'string', description: 'Descrição inicial do lead' },
                    value: { type: 'number', default: 0 },
                    board_id: { type: 'string', description: 'UUID do board' },
                    board_key: { type: 'string', description: 'Slug do board (alternativa ao board_id)' },
                    stage_id: { type: 'string', description: 'UUID do estágio (default: primeiro estágio)' },
                    contact_id: { type: 'string', description: 'UUID do contato' },
                    contact: {
                      type: 'object',
                      description: 'Criar/atualizar contato inline (alternativa ao contact_id)',
                      properties: {
                        name: { type: 'string' },
                        email: { type: 'string' },
                        phone: { type: 'string' },
                        role: { type: 'string' },
                        client_company_id: { type: 'string' },
                      },
                    },
                    client_company_id: { type: 'string' },
                    owner_id: { type: 'string', description: 'RESPONSÁVEL pelo lead: UUID de um usuário da organização (422 se não pertencer à org)' },
                    owner_email: { type: 'string', description: 'RESPONSÁVEL pelo lead: e-mail de um usuário da organização (alternativa ao owner_id)' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Tags do deal' },
                    custom_fields: { type: 'object', additionalProperties: true, description: 'Campos personalizados, indexados pela KEY do campo (veja GET /custom-fields). As UTMs também vão aqui, com as keys utm_source, utm_medium, utm_campaign, utm_content e utm_term — o CRM mostra na seção "UTMs" do card e no filtro. Ex: {"motivo_busca": "Revisão de contrato", "utm_source": "google"}' },
                    probability: { type: 'integer', minimum: 0, maximum: 100, description: 'Probabilidade de ganho (0-100)' },
                    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Prioridade' },
                    product_id: { type: 'string', description: 'UUID de um produto do catálogo (veja GET /products). Cria o item do deal e, se "value" não for enviado, usa o preço do produto como valor do deal.' },
                    products: {
                      type: 'array',
                      maxItems: 50,
                      description: 'Vários produtos/itens. Cada item usa product_id do catálogo (nome/preço automáticos) OU name+price manual.',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          product_id: { type: 'string', description: 'UUID do produto (nome/preço resolvidos do catálogo)' },
                          name: { type: 'string', maxLength: 200, description: 'Nome do item (item manual, sem product_id)' },
                          quantity: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
                          price: { type: 'number', minimum: 0, description: 'Sobrescreve o preço do catálogo' },
                        },
                      },
                    },
                    external_id: { type: 'string', description: 'ID externo para idempotência (reenvios com o mesmo external_id retornam o deal existente)' },
                  },
                  required: ['title'],
                },
                examples: {
                  comProduto: {
                    summary: 'Criar lead com contato + produto + campos + UTMs',
                    value: {
                      title: 'João da Silva',
                      board_key: 'pre-venda',
                      contact_id: '00000000-0000-0000-0000-000000000000',
                      description: 'Veio do Google Ads. Quer revisar contrato de veículo.',
                      product_id: '11111111-1111-1111-1111-111111111111',
                      custom_fields: {
                        motivo_busca: 'Revisão de contrato',
                        origem: 'Google Ads',
                        utm_source: 'google',
                        utm_medium: 'cpc',
                        utm_campaign: '[REVISIONAL] [LEADS] Pesquisa',
                        utm_content: 'anuncio-01',
                        utm_term: 'revisao de contrato',
                      },
                    },
                  },
                  comResponsavel: {
                    summary: 'Criar lead já com responsável (owner_email) + UTMs',
                    value: {
                      title: 'Maria Souza',
                      board_key: 'pre-venda',
                      contact: { name: 'Maria Souza', phone: '5569999990000' },
                      owner_email: 'vendedor@suaempresa.com.br',
                      custom_fields: {
                        origem: 'Meta Ads',
                        utm_source: 'Instagram_Feed',
                        utm_medium: '01 - [ABERTO | 20-55 | BR] [IMAGENS]',
                        utm_campaign: '[BPC] [LEADS] TYPEBOT',
                        utm_content: 'img-86afy78wv',
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Criado (action: "created")', content: { 'application/json': { schema: { type: 'object' } } } },
            200: { description: 'Negócio já existia (idempotência por contato+estágio aberto ou external_id) — retorna o existente (action: "existing")', content: { 'application/json': { schema: { type: 'object' } } } },
            422: { description: 'Payload inválido (ex.: owner_id/owner_email não pertence à organização — code OWNER_NOT_FOUND)' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/deals/{dealId}': {
        get: {
          tags: ['Deals'],
          summary: 'Obter deal',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Deal' } }, required: ['data'] } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        patch: {
          tags: ['Deals'],
          summary: 'Atualizar deal',
          description:
            'Atualização parcial (tudo opcional). Permite mudar etapa, tags e descrição numa única chamada — sem precisar de um POST /move-stage separado.',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string', nullable: true, description: 'Substitui a descrição (null limpa)' },
                    description_append: { type: 'string', description: 'Anexa este texto à descrição atual (nova linha). Exclusivo com description.' },
                    value: { type: 'number', description: 'Ignorado quando o valor é calculado por produtos' },
                    contact_id: { type: 'string', description: 'UUID do contato' },
                    client_company_id: { type: 'string', nullable: true },
                    owner_id: { type: 'string', nullable: true, description: 'RESPONSÁVEL pelo lead: UUID de um usuário da organização. null LIMPA o responsável.' },
                    owner_email: { type: 'string', description: 'RESPONSÁVEL pelo lead: e-mail de um usuário da organização (alternativa ao owner_id)' },
                    loss_reason: { type: 'string', nullable: true },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Substitui todas as tags' },
                    tags_add: { type: 'array', items: { type: 'string' }, description: 'Adiciona tags (dedup). Exclusivo com tags.' },
                    tags_remove: { type: 'array', items: { type: 'string' }, description: 'Remove tags. Exclusivo com tags.' },
                    custom_fields: { type: 'object', additionalProperties: true, description: 'Substitui todos os campos personalizados (pela KEY)' },
                    custom_fields_patch: { type: 'object', additionalProperties: true, description: 'Mescla campos; valor null remove a key. Exclusivo com custom_fields.' },
                    probability: { type: 'integer', minimum: 0, maximum: 100 },
                    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                    to_stage_id: { type: 'string', description: 'UUID do estágio de destino (move a etapa)' },
                    to_stage_label: { type: 'string', description: 'Label do estágio de destino (alternativa ao id)' },
                    mark: { type: 'string', enum: ['won', 'lost'], description: 'Marca como ganho/perdido' },
                    activity: {
                      type: 'object',
                      additionalProperties: false,
                      description: 'Cria uma atividade ligada a este deal na mesma chamada',
                      properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        date: { type: 'string', description: 'ISO; default = agora' },
                      },
                      required: ['type', 'title'],
                    },
                    product_id: { type: 'string', description: 'ADICIONA 1 produto do catálogo ao deal na mesma chamada (nome/preço automáticos; veja GET /products)' },
                    products_add: {
                      type: 'array',
                      maxItems: 50,
                      description: 'ADICIONA vários itens ao deal na mesma chamada. Cada item usa product_id do catálogo OU name+price manual.',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          product_id: { type: 'string', description: 'UUID do produto (nome/preço resolvidos do catálogo)' },
                          name: { type: 'string', maxLength: 200, description: 'Nome do item (item manual, sem product_id)' },
                          quantity: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
                          price: { type: 'number', minimum: 0, description: 'Sobrescreve o preço do catálogo' },
                        },
                      },
                    },
                  },
                },
                examples: {
                  qualificar: {
                    summary: 'Mover etapa + anexar descrição + adicionar tag (1 chamada)',
                    value: { to_stage_id: '00000000-0000-0000-0000-000000000000', description_append: 'Cliente enviou documentos.', tags_add: ['em-qualificacao'] },
                  },
                  qualificarCompleto: {
                    summary: 'Produto + etapa + tag + descrição (tudo em 1 chamada)',
                    value: {
                      product_id: '11111111-1111-1111-1111-111111111111',
                      to_stage_label: 'EM QUALIFICAÇÃO',
                      tags_add: ['qualificado'],
                      description_append: 'Lead qualificado: tem interesse no produto.',
                    },
                  },
                  editarCampos: {
                    value: { title: 'Maria Silva', priority: 'high', custom_fields_patch: { origem: 'Meta Ads' } },
                  },
                  definirResponsavel: {
                    summary: 'Definir/trocar o responsável do lead',
                    value: { owner_email: 'vendedor@suaempresa.com.br' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/deals/{dealId}/move-stage': {
        post: {
          tags: ['Deals'],
          summary: 'Mover etapa do deal',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        to_stage_id: { type: 'string', description: 'UUID do estágio de destino' },
                        mark: { type: 'string', enum: ['won', 'lost'], description: 'Opcional: marca o deal como ganho/perdido independentemente da etapa' },
                      },
                      required: ['to_stage_id'],
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        to_stage_label: { type: 'string', description: 'Label do estágio de destino (case-insensitive) dentro do board do deal' },
                        mark: { type: 'string', enum: ['won', 'lost'], description: 'Opcional: marca o deal como ganho/perdido independentemente da etapa' },
                      },
                      required: ['to_stage_label'],
                    },
                  ],
                },
                examples: {
                  byId: { value: { to_stage_id: '00000000-0000-0000-0000-000000000000' } },
                  byLabel: { value: { to_stage_label: 'Em conversa' } },
                  won: { value: { to_stage_label: 'Ganho', mark: 'won' } },
                },
              },
            },
          },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/deals/move-stage-by-identity': {
        post: {
          tags: ['Deals'],
          summary: 'Mover etapa do deal por telefone/email (sem UUID)',
          description:
            'Resolve o deal aberto dentro de um board usando `phone` e/ou `email` (regra: 1 deal aberto por board por telefone OU email) e move para a etapa indicada.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    board_key_or_id: { type: 'string', description: 'Key (slug) do board ou UUID do board' },
                    phone: { type: 'string', description: 'Telefone E.164 (ex: +5511999999999)' },
                    email: { type: 'string', description: 'Email (lowercase recomendado)' },
                    to_stage_label: { type: 'string', description: 'Label do estágio de destino (case-insensitive) dentro do board' },
                    to_stage_id: { type: 'string', description: 'UUID do estágio de destino (alternativa ao label)' },
                    mark: { type: 'string', enum: ['won', 'lost'], description: 'Opcional: marca o deal como ganho/perdido independentemente da etapa' },
                  },
                  required: ['board_key_or_id'],
                },
                examples: {
                  phone: { value: { board_key_or_id: 'sales', phone: '+5511999999999', to_stage_label: 'Em conversa' } },
                  email: { value: { board_key_or_id: 'sales', email: 'ana@acme.com', to_stage_label: 'Proposta' } },
                  won: { value: { board_key_or_id: 'sales', phone: '+5511999999999', to_stage_label: 'Ganho', mark: 'won' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/deals/move-stage': {
        post: {
          tags: ['Deals'],
          summary: 'Mover etapa do deal (UUID ou telefone/email)',
          description:
            'Move etapa via `deal_id` (UUID) ou via `board_key_or_id` + `phone/email` (sem UUID). Preferir usar `to_stage_label`.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        deal_id: { type: 'string', description: 'UUID do deal' },
                        to_stage_label: { type: 'string' },
                        to_stage_id: { type: 'string' },
                        mark: { type: 'string', enum: ['won', 'lost'], description: 'Opcional: marca o deal como ganho/perdido independentemente da etapa' },
                      },
                      required: ['deal_id'],
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        board_key_or_id: { type: 'string', description: 'Key (slug) do board ou UUID do board' },
                        phone: { type: 'string', description: 'Telefone E.164 (ex: +5511999999999)' },
                        email: { type: 'string', description: 'Email (lowercase recomendado)' },
                        to_stage_label: { type: 'string' },
                        to_stage_id: { type: 'string' },
                        mark: { type: 'string', enum: ['won', 'lost'], description: 'Opcional: marca o deal como ganho/perdido independentemente da etapa' },
                      },
                      required: ['board_key_or_id'],
                    },
                  ],
                },
                examples: {
                  byDealId: { value: { deal_id: '00000000-0000-0000-0000-000000000000', to_stage_label: 'Em conversa' } },
                  byPhone: { value: { board_key_or_id: 'sales', phone: '+5511999999999', to_stage_label: 'Em conversa' } },
                  won: { value: { board_key_or_id: 'sales', phone: '+5511999999999', to_stage_label: 'Ganho', mark: 'won' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/deals/{dealId}/notes': {
        get: {
          tags: ['Deals'],
          summary: 'Listar notas do deal',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'dealId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/DealNote' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Deals'],
          summary: 'Criar nota no deal',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { content: { type: 'string', minLength: 1 } },
                  required: ['content'],
                },
              },
            },
          },
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/DealNote' }, action: { type: 'string' } }, required: ['data'] } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/deals/{dealId}/items': {
        get: {
          tags: ['Deals'],
          summary: 'Listar produtos/itens do deal',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'dealId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/DealItem' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Deals'],
          summary: 'Adicionar produto/item ao deal',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    quantity: { type: 'integer', minimum: 1, default: 1 },
                    price: { type: 'number', minimum: 0, default: 0 },
                    product_id: { type: 'string', description: 'UUID de um produto cadastrado (opcional)' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/DealItem' }, action: { type: 'string' } }, required: ['data'] } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/deals/{dealId}/mark-won': {
        post: {
          tags: ['Deals'],
          summary: 'Marcar como ganho',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/deals/{dealId}/mark-lost': {
        post: {
          tags: ['Deals'],
          summary: 'Marcar como perdido',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'dealId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { loss_reason: { type: 'string' } } } } } },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/activities': {
        get: {
          tags: ['Activities'],
          summary: 'Listar atividades',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'deal_id', in: 'query', schema: { type: 'string' } },
            { name: 'contact_id', in: 'query', schema: { type: 'string' } },
            { name: 'client_company_id', in: 'query', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 250 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Activity' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                    required: ['data', 'nextCursor'],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Activities'],
          summary: 'Criar atividade',
          security: [{ ApiKeyAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
    },
  };
}

