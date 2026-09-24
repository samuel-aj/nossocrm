# Alertas de recuperação, sons e modelos com mídia

Direção aprovada por Samuel em 24/09/2026: card inteiro destacado (opção 2 da prévia), alerta desaparece ao abrir o lead; três sons e controle de volume; modelos Meta com imagem, vídeo ou documento, upload e prévia, disponíveis nos chats e robôs. Implementar e validar primeiro no staging.

## Alertas

Bloco `Ativar alerta` com texto configurável, padrão `Respondeu à recuperação`, colocado pelo usuário no ramo de resposta do robô. Persiste no lead correto da execução e nunca procura um lead de outra organização. Um alerta ativo por lead, substituído por novo disparo; id/versionamento impede que abrir uma versão antiga apague um alerta recém-chegado. Não duplicar o mesmo disparo numa retomada da execução.

Card com fundo verde suave, contorno verde e texto/ícone explícitos; manter informações, tags e indicadores existentes. Funciona nos temas claro e escuro e nas duas visualizações do board. Filtro `Com alertas`. Atualização em tempo real pela mesma cache de deals existente. Ao abrir com sucesso o lead, reconhecer o alerta no servidor. Abrir não envia mensagem nem muda a etapa. O alerta deve permanecer após recarregar e sumir para a equipe após o reconhecimento; registrar origem e reconhecimento para auditoria.

Notificação ao responsável do lead, respeitando permissões de acesso; sem responsável, o destaque no board permanece. Aviso com link ao lead, categoria independente de mensagens/leads e preferência própria. Sons e desktop respeitam preferências; não disparar duas vezes por múltiplas abas. Atualizar o responsável antes da consulta da notificação para evitar vazamento ao antigo responsável.

## Sons

Opções `Atual`, `Campainha`, `Alerta`, slider 0–100%, botão de teste usando seleção/volume ainda não salvos. 100% mais audível que o beep atual sem clipping; preferências antigas preservadas, sem reset de mensagens/boards. Preferências por usuário e organização. Sem som em volume zero, quando desativado ou AudioContext bloqueado. Não altera volume do sistema.

## Mídia

Modelos oficiais podem escolher Sem mídia, Imagem, Vídeo, Documento; validar formato/tamanho, fazer upload, mostrar prévia e criar HEADER na Meta com amostra válida. Salvar referência persistente para uso posterior. Importação/sincronização deve preservar o tipo do header e informar mídia faltante; não enviar modelo que exige mídia sem fornecê-la. Chat e robô usam o mesmo resolvedor de header, com arquivos restritos à organização/conexão. Segredos/tokens nunca chegam ao cliente. URLs arbitrárias não podem causar SSRF. Modelo livre/text-only existente não muda.

Nenhuma mensagem de teste para clientes, nenhuma mudança em robôs reais, nenhum template submetido à Meta sem pedido específico. Testes usam mocks e dados isolados. Staging é o alvo desta entrega; produção só após revisão de Samuel.
