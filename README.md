# AgendaZap

Sistema de agendamento automatizado de consultas via WhatsApp para clínicas médicas, odontológicas e estéticas.

O paciente conversa com um bot inteligente no WhatsApp que agenda consultas sem intervenção humana. A clínica gerencia tudo por um painel web.

---

## Arquitetura

| Camada | Tecnologia |
|---|---|
| Canal de entrada | WhatsApp Business API via Evolution API v2 (self-hosted, Docker) |
| Servidor | Node.js 20+ com Fastify |
| IA | Claude API (`claude-sonnet-4-20250514`) |
| Agenda | Google Calendar API |
| Banco | PostgreSQL 16 com Prisma ORM |
| Fila | BullMQ + Redis |
| Painel admin | React 18 + Vite + shadcn/ui + Tailwind CSS |
| Auth | JWT + bcrypt |

---

## O que foi implementado — Etapa 5

- **`src/config/queues.js`** — três filas BullMQ:
  - `remindersQueue` — processa envios de lembrete (3 tentativas, backoff exponencial de 5 min)
  - `checkResponseQueue` — detecta não-resposta 4h após o lembrete (1 tentativa)
  - `scannerQueue` — fila do cron de varredura horária
- **`src/services/reminderService.js`**:
  - `ajustarParaDiaUtil(dataHoraLembrete)` — se o momento calculado (dataHora - 24h) cair em sábado ou domingo, recua para a sexta-feira anterior mantendo o mesmo horário (fuso `America/Sao_Paulo`)
  - `scheduleReminderIfNeeded(agendamentoId)` — enfileira job de lembrete se `opt_in_lembrete = true`; só enfileira imediatamente se a consulta ocorre em menos de 25h; caso contrário aguarda o cron horário
  - `cancelReminder(agendamentoId)` — remove o job da fila pelo `reminderJobId` salvo no banco
- **`src/services/calendarService.js`** (atualizado): adicionada `getEventById` — busca evento por ID para detectar alterações manuais feitas no Google Calendar pela recepção
- **`src/jobs/sendReminder.js`** — worker `reminders`:
  - Hard stop por `status !== 'confirmado'` e `lembreteEnviadoAt !== null` (idempotência)
  - Verifica horário no Google Calendar antes de enviar — atualiza banco silenciosamente se horário mudou
  - Envia mensagem com menu de 3 opções (confirmar / remarcar / cancelar)
  - Atualiza `EstadoConversa` para `aguardando_resposta_lembrete` se paciente não estiver em fluxo ativo
  - Salva lembrete na tabela `conversas` com `metadata_json: { tipo: 'lembrete', agendamentoId }`
  - Enfileira job de verificação de resposta com delay de 4h
- **`src/jobs/checkReminderResponse.js`** — worker `check-response`: reseta `EstadoConversa` para `inicio` se paciente não respondeu em 4h (evita que o estado fique preso)
- **`src/jobs/reminderScanner.js`** — cron worker `reminder-scanner`: roda a cada 1h; na sexta-feira estende a janela para 73h para cobrir agendamentos de segunda (cujo lembrete seria enviado no domingo → antecipado para sexta); usa `jobId` para deduplicação automática
- **`src/services/conversationService.js`** (atualizado):
  - Estado `aguardando_resposta_lembrete`: interpreta diretamente sem chamar IA — "1" confirma, "2" abre fluxo de remarcação existente, "3" aciona cancelamento existente
  - Após criar agendamento: pergunta sobre opt-in de lembrete e salva estado `concluido` aguardando resposta
  - `remarcar_agendamento`: cancela lembrete antigo e agenda novo
  - `cancelar_agendamento`: cancela lembrete do agendamento removido
- **`src/webhooks/whatsapp.js`** (atualizado): mensagens com mais de 30 minutos são ignoradas — evita processar fila acumulada durante downtime do servidor
- **`prisma/schema.prisma`** (atualizado):
  - `Paciente`: coluna `opt_in_lembrete BOOLEAN DEFAULT TRUE`
  - `Agendamento`: `lembrete_enviado_at TIMESTAMP` (substitui o boolean), `reminder_job_id VARCHAR`
  - `EstadoBot`: valor `aguardando_resposta_lembrete` adicionado ao enum
- **`src/server.js`** (atualizado): importa e inicia os 3 workers; registra o cron de varredura horária; fecha workers adequadamente no graceful shutdown

---

## O que foi implementado — Etapa 4

- **`src/config/google.js`** — cliente OAuth2 do Google:
  - `getAuthUrl(clinicaId)` — gera URL de consentimento com `access_type: offline` e `prompt: consent` para garantir retorno do `refresh_token`
  - `handleCallback(code, clinicaId)` — troca o code pelo par de tokens e persiste o `refresh_token` no banco
  - `getAuthenticatedClient(clinicaId)` — retorna cliente OAuth2 com credenciais válidas (auto-renova o `access_token` a partir do `refresh_token` salvo)
- **`src/services/calendarService.js`** — integração Google Calendar:
  - `listCalendars(clinicaId)` — lista todos os calendários da conta conectada
  - `getAvailableSlots(clinicaId, profissionalId, dataInicio, dataFim)` — consulta `freebusy.query`, cruza com horário de funcionamento (configJson), respeita duração da consulta, intervalo entre slots e antecedência mínima de 2h; fallback automático para mock se Calendar inacessível
  - `createEvent(clinicaId, profissionalId, agendamento)` — cria evento com summary, description e timezone `America/Sao_Paulo`; retorna o `calendar_event_id`
  - `deleteEvent(clinicaId, profissionalId, calendarEventId)` — remove evento (cancelamentos)
  - `checkConflict(clinicaId, profissionalId, dataHora, duracaoMin)` — verifica via `freebusy` se o horário ainda está livre imediatamente antes de confirmar (evita race condition)
- **`src/routes/admin/googleAuth.js`** — fluxo OAuth:
  - `GET /admin/google/auth/:clinicaId` → redireciona para consentimento Google
  - `GET /admin/google/callback` → troca code por tokens, salva, redireciona para o painel
  - `GET /admin/google/status/:clinicaId` → retorna `{ conectado: true/false }`
- **`src/routes/admin/professionals.js`** — gerenciamento de profissionais:
  - `GET /admin/calendars/:clinicaId` → lista calendários disponíveis na conta conectada
  - `PUT /admin/profissionais/:profissionalId/calendar` → vincula um `calendarId` ao profissional
- **`src/services/conversationService.js`** (atualizado):
  - Substituído `generateMockSlots` por `calendarService.getAvailableSlots` (com fallback automático para mock)
  - Antes de criar o agendamento: chama `checkConflict` — se houver conflito, avisa o paciente e volta ao estado `escolhendo_horario`
  - Após criar o registro no banco: chama `createEvent` e persiste o `calendar_event_id` no agendamento
- **`prisma/schema.prisma`** (atualizado): coluna `google_refresh_token` adicionada ao model `Clinica`

---

## Como conectar o Google Calendar (Etapa 4)

### 1. Criar credenciais no Google Cloud Console

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto (ou use um existente)
3. Ative a **Google Calendar API**
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth 2.0**:
   - Tipo: **Aplicativo da Web**
   - URI de redirecionamento autorizado: `http://localhost:3000/admin/google/callback`
5. Copie o **Client ID** e o **Client Secret** para o `.env`

### 2. Atualizar o banco após adicionar a coluna

```bash
npm run db:push
```

### 3. Autorizar uma clínica (obter o ID da clínica via seed ou banco)

Abra no navegador:
```
http://localhost:3000/admin/google/auth/<CLINICA_ID>
```

Faça login com a conta Google que tem os calendários dos profissionais e clique em **Permitir**.

### 4. Verificar que a autorização foi salva

```bash
curl http://localhost:3000/admin/google/status/<CLINICA_ID>
# Esperado: { "success": true, "data": { "conectado": true } }
```

### 5. Listar calendários disponíveis

```bash
curl http://localhost:3000/admin/calendars/<CLINICA_ID>
```

### 6. Vincular um calendar a um profissional

```bash
curl -X PUT http://localhost:3000/admin/profissionais/<PROFISSIONAL_ID>/calendar \
  -H "Content-Type: application/json" \
  -d '{"calendarId": "email@gmail.com"}'
```

### 7. Testar o fluxo completo

Envie mensagens pelo WhatsApp como de costume. O bot agora exibe horários reais do Google Calendar. Ao confirmar o agendamento:
- Um evento é criado no Google Calendar do profissional
- Se um horário for marcado diretamente no Google Calendar, ele não aparecerá mais como disponível no bot
- Se dois pacientes tentarem o mesmo horário simultaneamente, o segundo recebe aviso e é direcionado a escolher outro

---

## O que foi implementado — Etapa 3

- **`src/services/claudeService.js`** — integração com Claude API:
  - `buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa)` — monta o system prompt completo com identidade do bot, regras, profissionais, horários disponíveis e estado atual
  - `processMessage(messageText, systemPrompt, recentHistory, estadoAtual)` — chama `claude-sonnet-4-20250514` com histórico das últimas 10 mensagens; extrai mensagem ao paciente e JSON de controle das tags `<json></json>`; trata timeout (25s), rate limit (429) e erros de servidor com mensagem de fallback amigável
- **`src/services/conversationService.js`** — orquestrador central:
  - `handleIncomingMessage(clinicaId, telefone, mensagemTexto, clinica)` — busca/cria paciente e estado da conversa, monta contexto, chama Claude, processa JSON de controle, atualiza estado, cria agendamento quando confirmado e adiciona contato humano em respostas de baixa confiança (< 0.6)
  - Histórico sempre busca as **N mensagens mais recentes** (`orderBy: desc` + `reverse`) — evita janela deslizante partir do início e Claude perder contexto recente
- **`src/utils/mockSlots.js`** — gerador de horários fictícios:
  - `generateMockSlots(profissionalId, duracaoMin, diasUteis)` — gera slots para os próximos N dias úteis (seg–sex, 08:00–18:00) com 30–40% dos slots removidos aleatoriamente para simular agenda parcialmente ocupada
- **`src/webhooks/whatsapp.js`** (atualizado) — conectado ao `conversationService`, com fallback de erro exibindo telefone da clínica; processa JIDs `@lid` (protocolo novo do WhatsApp — nem sempre vem duplicado com `@s.whatsapp.net`)
- **`src/server.js`** (atualizado) — `bodyLimit: 10485760` (10MB) para suportar payloads grandes da Evolution API (mensagens com mídia codificada em base64 causavam HTTP 413)
- **Testes automatizados** (55 testes, Vitest):
  - `src/services/__tests__/claudeService.test.js` — parsing JSON de controle, fallbacks de erro, `buildSystemPrompt`
  - `src/services/__tests__/conversationService.test.js` — todas as transições de estado da máquina de estados
  - `src/webhooks/__tests__/whatsapp.test.js` (atualizado) — filtros do webhook, mock de `conversationService`

---

## O que foi implementado — Etapa 2

- **`src/services/whatsappService.js`** — integração com Evolution API:
  - `createInstance(instanceName, webhookUrl)` — cria instância e configura webhook
  - `getQRCode(instanceName)` — retorna QR code para conectar o celular da clínica
  - `sendTextMessage(instanceName, phone, text)` — envia mensagem com retry automático (2 tentativas)
  - `getInstanceStatus(instanceName)` — retorna estado da conexão (`open`, `close`, `connecting`)
- **`src/webhooks/whatsapp.js`** — rota `POST /webhook/whatsapp` que:
  - Ignora mensagens `fromMe`, de grupos (`@g.us`), status/broadcast e mídias
  - Identifica a clínica pelo nome da instância (telefone da clínica)
  - Busca ou cria o paciente automaticamente
  - Salva mensagens recebidas e enviadas na tabela `conversas`
  - Responde com mensagem placeholder (IA integrada na Etapa 3)
  - Retorna sempre `200` para a Evolution API não reenviar eventos
- **`src/routes/admin/instance.js`** — rotas administrativas:
  - `POST /admin/instance/create` — cria instância para uma clínica
  - `GET /admin/instance/:clinicaId/qrcode` — retorna QR escaneável
  - `GET /admin/instance/:clinicaId/status` — retorna estado da conexão
- **`src/utils/phoneHelper.js`** — helpers de telefone:
  - `formatToWhatsApp`, `formatFromWhatsApp`, `extractDDD`, `isValidBRPhone`

> **Fix importante:** Evolution API v2.1.1 usa Baileys com versão desatualizada do protocolo WhatsApp.
> A variável `CONFIG_SESSION_PHONE_VERSION=2.3000.1035194821` no docker-compose corrige a compatibilidade.

---

## O que foi implementado — Etapa 1

- **Estrutura completa de pastas** do projeto
- **Docker Compose** com 3 serviços: PostgreSQL 16, Redis 7, Evolution API v2.2.3
- **Schema Prisma** com todas as tabelas: `clinicas`, `profissionais`, `pacientes`, `agendamentos`, `conversas`, `estado_conversa`
- **Configuração base do servidor Fastify** com CORS, JWT, graceful shutdown
- **Validação de variáveis de ambiente** com Zod (falha rápido na inicialização se algo estiver faltando)
- **Conexão com PostgreSQL** via Prisma com log de queries em desenvolvimento
- **Conexão com Redis** via IORedis com retry automático e backoff
- **Rota `GET /health`** que verifica conexão real com banco e Redis
- **Seed de desenvolvimento** com 1 clínica e 3 profissionais

---

## Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://nodejs.org/)

---

## Como rodar

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas chaves reais (veja a seção de variáveis abaixo).

### 3. Subir a infraestrutura (PostgreSQL, Redis, Evolution API)

```bash
docker compose up -d
```

Aguarde todos os serviços ficarem `healthy`:

```bash
docker ps
```

### 4. Criar as tabelas no banco

```bash
npm run db:push
```

### 5. Popular dados de teste (desenvolvimento)

```bash
npm run db:seed
```

Insere:
- Clínica: **Clínica Saúde Plena** — `55619 9999-0001`
- Profissionais: Dr. João Silva (Clínico Geral), Dra. Maria Santos (Dermatologia), Dra. Ana Costa (Nutrição)

### 6. Iniciar o servidor

```bash
npm run dev
```

O servidor sobe em `http://localhost:3000`.

---

## Conectando o WhatsApp (Etapa 2)

### 1. Criar a instância da clínica

```bash
curl -X POST http://localhost:3000/admin/instance/create \
  -H "Content-Type: application/json" \
  -d '{"clinicaId": "ID_DA_CLINICA"}'
```

### 2. Obter o QR code

```bash
curl http://localhost:3000/admin/instance/ID_DA_CLINICA/qrcode
```

O campo `code` na resposta é o conteúdo do QR code. Cole-o em qualquer gerador de QR online (ex: `qr-code-generator.com`) ou acesse o Manager em `http://localhost:8080/manager`.

### 3. Escanear com o celular

Abra o WhatsApp no celular do número cadastrado na clínica → Menu → Aparelhos conectados → Conectar aparelho → escaneie o QR.

### 4. Verificar status

```bash
curl http://localhost:3000/admin/instance/ID_DA_CLINICA/status
# Esperado: { "state": "open" }
```

---

## Testando o bot (Etapa 3)

Com o WhatsApp conectado e o servidor rodando, envie mensagens para o número da clínica e observe o fluxo completo:

| Mensagem | Comportamento esperado |
|---|---|
| `oi` | Saudação + lista de especialidades disponíveis |
| `dermatologia` (ou `2`, nome do profissional) | Bot mostra horários disponíveis nos próximos 5 dias úteis |
| `segunda às 09:00` | Bot pede confirmação com nome do paciente |
| `sim, João da Silva` | Bot confirma o agendamento e cria registro no banco |
| `aceita convênio?` | Resposta educada fora do escopo + redirecionamento |

**Verificar agendamento no banco:**
```bash
docker exec -it agendazap-postgres-1 psql -U agendazap -d agendazap -c "SELECT * FROM agendamentos;"
```

**Verificar histórico de mensagens:**
```bash
docker exec -it agendazap-postgres-1 psql -U agendazap -d agendazap -c "SELECT direcao, mensagem, created_at FROM conversas ORDER BY created_at;"
```

**Verificar estado da conversa:**
```bash
docker exec -it agendazap-postgres-1 psql -U agendazap -d agendazap -c "SELECT telefone, estado, contexto_json FROM estado_conversa;"
```

---

## Testando

### Health check

```bash
curl http://localhost:3000/health
```

Resposta esperada:
```json
{
  "status": "ok",
  "timestamp": "2026-03-28T...",
  "services": { "db": true, "redis": true }
}
```

### Evolution API

Acesse `http://localhost:8080` — deve retornar a mensagem de boas-vindas da API v2.2.3.

---

## Variáveis de ambiente

| Variável | Descrição | Exemplo |
|---|---|---|
| `DATABASE_URL` | URL de conexão PostgreSQL | `postgresql://user:pass@localhost:5432/agendazap` |
| `REDIS_URL` | URL de conexão Redis | `redis://localhost:6379` |
| `EVOLUTION_API_URL` | URL da Evolution API | `http://localhost:8080` |
| `EVOLUTION_API_KEY` | Chave de autenticação da Evolution API | `agendazap-dev-key` |
| `CLAUDE_API_KEY` | Chave da Anthropic (Claude API) | `sk-ant-...` |
| `GOOGLE_CLIENT_ID` | Client ID do Google Cloud Console | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | URI de callback OAuth do Google | `http://localhost:3000/admin/google/callback` |
| `ADMIN_URL` | URL base do painel admin (redirecionamento pós-OAuth) | `http://localhost:5173` |
| `JWT_SECRET` | Segredo para assinar tokens JWT (mín. 16 chars) | `string-longa-e-secreta` |
| `PORT` | Porta do servidor (padrão: 3000) | `3000` |
| `NODE_ENV` | Ambiente de execução | `development` |

---

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia em modo desenvolvimento com hot-reload (nodemon) |
| `npm start` | Inicia em modo produção |
| `npm test` | Roda todos os testes automatizados uma vez (Vitest) |
| `npm run test:watch` | Roda testes em modo watch (re-executa ao salvar) |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:push` | Sincroniza o schema com o banco (sem migration) |
| `npm run db:migrate` | Cria e aplica uma migration nomeada |
| `npm run db:seed` | Popula o banco com dados de desenvolvimento |

---

## Modelo de dados

```
Clinicas ──< Profissionais
         ──< Pacientes ──< Agendamentos
         ──< Agendamentos
         ──< Conversas
         ──< EstadoConversa (chave composta: telefone + clinica_id)
```

O sistema é **multi-tenant**: cada clínica é um tenant isolado. A identificação da clínica é feita pelo número de WhatsApp que recebeu a mensagem.