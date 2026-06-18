# Histórico de mudanças no código

Documentação de todas as alterações feitas no código, da base do tutorial
oficial do Socket.IO até as funcionalidades e correções próprias do projeto.
Para o resumo focado das últimas correções, veja também [`CHANGES.md`](./CHANGES.md).

---

## 1. Base do tutorial (`6b6006c` … `8cc6b0e`, `d37b0b0`)

Pontos de partida do [tutorial oficial do Socket.IO](https://socket.io/docs/v4/tutorial/introduction),
commitados como "step #1" a "step #9":

- **step #1** — servidor Express + HTTP + Socket.IO básico.
- **step #2** — formulário no `index.html` e emissão do evento `chat message`.
- **step #3** — broadcast da mensagem para todos os clientes.
- **step #4/#5** — renderização das mensagens recebidas na lista.
- **step #6** — ajustes de emissão/recepção.
- **step #7** — persistência em SQLite e recuperação de histórico.
- **step #8** — confirmação (ack) das mensagens com `client_offset` (idempotência).
- **step #9** — recuperação de estado de conexão (`connectionStateRecovery`).
- **`d37b0b0` refactor** — migração de CommonJS para ESM (`import`/`export`).

## 2. Infra e configuração (`df6359d`, `c4c0784`, `07a183a`)

- **`df6359d`** — configuração do CodeSandbox (Dockerfile + tasks).
- **`c4c0784`** — adição do `README.md`.
- **`07a183a` fix** — resolução correta de caminho relativo do arquivo servido
  (usar `dirname(fileURLToPath(import.meta.url))` em vez de caminho relativo).

## 3. Robustez e validação (`d2b64c6`, `a3aa726`)

- **`d2b64c6` fix** — tratamento de erro do banco usando o código de string
  `SQLITE_CONSTRAINT` (em vez de número mágico) e log dos erros antes
  silenciados.
- **`a3aa726` feat** — validação no servidor: tipo string, não-vazio e limite
  de 500 caracteres por mensagem.

## 4. Arquitetura (`84f2377`)

- **`84f2377` refactor** — separação em módulos:
  - `db.js` — abertura do banco e criação da tabela `messages`.
  - `chat.js` — `registerChatHandlers(io, socket, db)`, lógica de chat
    isolada e testável por injeção de dependências.
  - `index.js` — apenas montagem do servidor e conexões.

## 5. Funcionalidades (`5ed6732` … `1d9cd6b`, `05896fa`)

- **`5ed6732` feat** — nomes de usuário: enviados na autenticação, salvos no
  banco e exibidos ao lado das mensagens.
- **`34b4dcd` feat** — indicador de digitação (`typing` / `stop typing`)
  com broadcast.
- **`d393205` feat** — contagem de usuários online no connect/disconnect.
- **`619cea3` feat** — armazenamento e exibição de timestamp das mensagens.
- **`ba9e1f5` feat** — mensagens de sistema ao entrar/sair do chat.
- **`1d9cd6b` feat** — UX do campo de entrada: contador de caracteres, Enter
  para enviar, Shift+Enter para nova linha, textarea com auto-resize.
- **`05896fa` feat** — mensagens privadas 1-a-1 e barra lateral de usuários
  online (clique no nome abre painel privado).

## 6. Testes (`45bb87a`, `f77bd35`)

- **`45bb87a` test** — suíte de integração (Vitest + socket.io-client):
  mensagens, validação e indicador de digitação.
- **`f77bd35` test** — expansão: timestamps, mensagens de sistema e privadas.

## 7. Documentação (`7a7dc73`, `7510abe`)

- **`7a7dc73` docs** — slideshow de apresentação em português (`apresentacao.html`).
- **`7510abe` docs** — expansão dos slides com conteúdo detalhado, comparações
  e contexto técnico.

## 8. Correções recentes

### `e49db57` — evitar crash no envio e corrigir presença
- Porta com fallback seguro.
- Recuperação de mensagens com tratamento de erro (`logger.js` adicionado).
- Presença consolidada numa única fonte (um `Map` por processo) — antes
  contava errado sob processo único.

### `6ff1dfd` — confirmar (ack) eventos em tempo real

Causa de fundo: o cliente roda com `retries: 3` + `ackTimeout: 10000`, ativando
o modo de **garantia de entrega ordenada** do Socket.IO — cada emit precisa de
ack antes do próximo ser enviado.

- **`chat.js`** — `typing` / `stop typing` agora confirmam (ack). Antes, o
  evento de digitação travava a fila e a `chat message` enviada logo depois
  não chegava ao servidor → **mensagem não aparecia na tela**.
- **`index.js`** — `private message` agora confirma (ack) e retorna
  `{ error }` em entrada inválida. Antes, sem ack, o cliente reenviava após o
  `ackTimeout` → **mensagem privada duplicada**.
- **`index.js` + `index.html`** — direção da mensagem privada passa a usar um
  flag explícito `self` (em vez de comparar nomes, que não são únicos) →
  corrige exibição quando dois usuários têm o mesmo nome. Removido código
  morto no cliente.
- **`tests/chat.test.js`** — handler espelhado atualizado.

---

## Estado atual dos arquivos

| Arquivo              | Responsabilidade |
|----------------------|------------------|
| `index.js`           | Montagem do servidor, conexões, presença, mensagens privadas |
| `chat.js`            | Handlers de chat (mensagens, digitação, recuperação) |
| `db.js`              | Abertura do SQLite e schema da tabela `messages` |
| `logger.js`          | Logging centralizado |
| `index.html`         | Cliente (UI, socket, chat público e privado) |
| `tests/chat.test.js` | Testes de integração (12 testes) |
| `apresentacao.html`  | Slideshow de apresentação |

**Verificação:** `npm test` → 12 testes passando.
