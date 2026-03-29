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
| `GOOGLE_REDIRECT_URI` | URI de callback OAuth do Google | `http://localhost:3000/auth/google/callback` |
| `JWT_SECRET` | Segredo para assinar tokens JWT (mín. 16 chars) | `string-longa-e-secreta` |
| `PORT` | Porta do servidor (padrão: 3000) | `3000` |
| `NODE_ENV` | Ambiente de execução | `development` |

---

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia em modo desenvolvimento com hot-reload (nodemon) |
| `npm start` | Inicia em modo produção |
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
