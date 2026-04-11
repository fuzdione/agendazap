# AgendaZap — Plano do Painel do Proprietário (Super Admin)

## Objetivo

Permitir que o dono da solução AgendaZap gerencie clínicas clientes sem precisar
executar comandos manuais no banco de dados ou editar arquivos de configuração.
O painel deve cobrir apenas o essencial operacional — cadastro de clínicas, criação
de acesso admin, visão de status das instâncias WhatsApp e saúde geral do sistema.

---

## O que resolve hoje manualmente

| Situação atual | Com o painel |
|---|---|
| Nova clínica: rodar seed no servidor | Formulário de cadastro |
| Criar usuário admin da clínica: SQL direto | Criado junto com a clínica |
| Resetar senha da clínica: SQL direto | Botão de reset no painel |
| Ver se WhatsApp está conectado: logs do Docker | Status visual em tempo real |
| Desativar clínica inadimplente: SQL UPDATE | Toggle ativo/inativo |
| Ver volume de agendamentos por clínica: SQL | Tabela resumo |

---

## Funcionalidades Essenciais

### 1. Autenticação do Proprietário
- Login separado do admin das clínicas (email + senha)
- JWT com role `owner` — não tem acesso às rotas de clínica
- Rate limit igual ao login de clínica (já implementado no padrão)
- Usuário owner criado via variável de ambiente no primeiro deploy
  (ex: `OWNER_EMAIL` / `OWNER_SENHA` — similar ao seed atual)

### 2. Gestão de Clínicas

**Listagem:**
- Tabela com: nome, telefone WhatsApp, status WhatsApp (conectado/desconectado),
  total de agendamentos, data de cadastro, ativo/inativo
- Busca por nome ou telefone

**Cadastro de nova clínica:**
- Campos: nome, telefone WhatsApp, endereço (opcional)
- Cria automaticamente: registro na tabela `clinicas` + usuário admin inicial
- Email e senha do admin informados no mesmo formulário
- Elimina completamente a necessidade do seed para novas clínicas

**Ações por clínica:**
- Ativar / Desativar (toggle no campo `ativo`) — bloqueia o bot sem apagar dados
- Resetar senha do admin (gera nova senha e exibe uma vez na tela)
- Ver detalhes: profissionais cadastrados, total de pacientes, agendamentos do mês

### 3. Status das Instâncias WhatsApp

- Lista todas as instâncias com status em tempo real (conectado / desconectado / sem instância)
- Botão "Ver QR Code" para reconectar instâncias desconectadas
- Reutiliza as rotas já existentes:
  `GET /admin/instance/:clinicaId/status`
  `GET /admin/instance/:clinicaId/qrcode`
  `POST /admin/instance/create`
- Status atualizado a cada 30s via polling simples (sem websocket)

### 4. Visão Geral do Sistema (Dashboard)

Métricas simples, sem analytics avançado:
- Total de clínicas ativas
- Total de agendamentos nas últimas 24h (todas as clínicas)
- Status de infraestrutura: banco de dados, Redis, Evolution API (reutiliza `/health`)
- Clínicas com instância WhatsApp desconectada (alerta visual)

---

## O que NÃO está no escopo

- Faturamento ou cobrança de clínicas
- Logs detalhados de conversas de cada clínica
- Gerenciamento de profissionais ou configurações internas da clínica
  (isso é responsabilidade do admin da própria clínica)
- Relatórios ou exportação de dados
- Múltiplos usuários owner com permissões diferentes
- Notificações por e-mail ou WhatsApp para o proprietário

---

## Arquitetura Proposta

### Backend — mínimo de novas peças

**Nova tabela no schema Prisma:**
```prisma
model UsuarioOwner {
  id        String   @id @default(uuid())
  email     String   @unique
  senhaHash String   @map("senha_hash")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("usuarios_owner")
}
```

**Novas rotas (prefixo `/owner`):**
```
POST /owner/auth/login          → autenticação do proprietário
GET  /owner/clinicas            → lista todas as clínicas com resumo
POST /owner/clinicas            → cria clínica + usuário admin
PUT  /owner/clinicas/:id/toggle → ativa/desativa
POST /owner/clinicas/:id/reset-senha → reseta senha do admin
GET  /owner/clinicas/:id        → detalhes de uma clínica
GET  /owner/status/instancias   → status WhatsApp de todas as clínicas
GET  /owner/dashboard           → métricas globais
```

**Middleware de autenticação:** decorator `authenticateOwner` separado do
`authenticate` existente — valida role `owner` no JWT.

**Seed:** adicionar criação do `UsuarioOwner` ao seed existente,
controlado por `OWNER_EMAIL` / `OWNER_SENHA` no `.env`.

### Frontend — aplicação separada

**Por que separado do painel da clínica:**
- URLs distintas: `/owner` vs `/painel`
- Código e autenticação completamente isolados — um bug no owner não
  afeta o painel da clínica
- Build independente, mesma stack (React + Vite + Tailwind)

**Estrutura de pastas:**
```
owner-panel/          ← novo diretório (espelho de admin-panel/)
  src/
    pages/
      Login.jsx
      Dashboard.jsx
      Clinicas.jsx      ← listagem + cadastro
      ClinicaDetalhe.jsx
      Instancias.jsx
    context/
      AuthContext.jsx
    services/
      api.js            ← baseURL: /api-owner (ou /owner via nginx)
  vite.config.js        ← base: '/owner'
```

**Nginx:** adicionar location `/owner/` similar ao `/painel/` já existente.

**Docker Compose:** adicionar volume `./owner-panel/dist:/usr/share/nginx/html/owner:ro`.

**Deploy.sh:** adicionar build do `owner-panel/` similar ao `admin-panel/`.

---

## Telas (5 páginas)

| Página | Conteúdo |
|---|---|
| **Login** | Email + senha, mesmo visual do painel da clínica |
| **Dashboard** | Cards: clínicas ativas, agendamentos 24h, status infra, alertas |
| **Clínicas** | Tabela com busca, botão "Nova Clínica", toggle ativo, ações |
| **Detalhe da Clínica** | Dados, profissionais, reset de senha, status WhatsApp + QR |
| **Instâncias** | Lista de todas as clínicas com status WhatsApp e QR em modal |

---

## Estimativa de Complexidade

| Parte | Esforço |
|---|---|
| Schema Prisma (1 tabela) | Baixo |
| Rotas backend (8 endpoints) | Médio |
| Frontend (5 páginas) | Médio |
| Nginx + Docker + deploy.sh | Baixo (cópia do padrão já existente) |
| **Total** | **Médio — sem dependências externas novas** |

A maior parte do trabalho é no frontend. O backend reutiliza
padrões já estabelecidos no projeto (Prisma, JWT, Fastify).
