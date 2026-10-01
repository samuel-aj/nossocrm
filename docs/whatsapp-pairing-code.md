# Conexão por código — preview

Branch: `feat/whatsapp-pairing-code`, baseada na `main` em `8c7b09d`.

Na página Conexão do WhatsApp, cada conexão pelo celular oferece QR Code e código de pareamento. O administrador escolhe o método antes de gerar a tentativa. Para código, informa país e telefone e digita no celular o código mostrado pelo CRM, em Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone.

## Implementação

- `POST /api/whatsapp/connection/pair`: autentica o administrador, verifica a organização e a conexão, valida o telefone e solicita o pareamento. API oficial da Meta e números já conectados em outra conexão da organização são recusados.
- `GET /api/whatsapp/connection/pair?id=...`: consulta a tentativa a cada quatro segundos enquanto o painel estiver aberto. Não inicia novamente uma sessão expirada.
- Evolution: usa `GET /instance/connect/{instance}?number=...`. Somente `pairingCode` é tratado como código de pareamento; `code` contém o QR bruto.
- Ao renovar ou trocar o método, consulta o estado real. Uma sessão `open` é preservada. Uma tentativa ainda `connecting` é conferida novamente e encerrada antes da nova tentativa, porque Evolution ignora outro telefone enquanto está conectando.
- Instâncias removidas no servidor configurado são recuperadas após um 404 confirmado, com token e webhook atualizados. Falhas de autenticação ou rede não disparam essa recuperação.
- Códigos ficam apenas no estado local do painel. As respostas usam `Cache-Control: private, no-store`; fechar, mudar o telefone/método ou expirar remove o código da tela.

## Ambiente e verificação

O preview usa o Supabase de homologação `mggvzlmquzqcloprxmoe`, com variáveis específicas desta branch. A Evolution usa o servidor já utilizado pelo CRM. Não houve migração nem publicação de Edge Functions. A staging de grupos permanece na própria branch.

- Testes automatizados cobrem telefone, permissões, isolamento entre organizações, duplicidade, sessão já aberta, recuperação, expiração, alternância, respostas atrasadas e geração de QR.
- Verificação real na Evolution 2.3.7: criação de instância temporária, geração de QR, renovação de tentativa pendente e consulta de estado. A instância temporária foi removida.
- Navegador: API autenticada rejeita conexão desconhecida; formulário validado em desktop e celular, tema claro/escuro, busca de país, cópia, expiração e alternância. Respostas de pareamento simuladas na verificação visual.
- Build local validado com Webpack porque os node_modules compartilhados por symlink ficam fora da raiz do Turbopack. O preview remoto compila com o comando normal do projeto.
- Lint dos arquivos alterados passa. O lint global identifica um aviso anterior em `components/navigation/NavigationRail.tsx:39` (`@next/next/no-img-element`).

A confirmação de um código real depende da ação do titular no WhatsApp do celular. Gerar um código, por si só, não confirma uma conexão concluída. Usar um número de teste dedicado para a validação final.
