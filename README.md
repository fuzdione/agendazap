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
