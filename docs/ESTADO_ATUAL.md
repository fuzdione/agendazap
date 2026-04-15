# Estado Atual do AgendaZap

> Relatório gerado em 2026-04-15. Documenta o estado completo de funcionalidades, integrações, limitações e números técnicos.

---

## 1. Funcionalidades do Bot WhatsApp

### 1.1 Fluxos Implementados

O bot opera via máquina de estados com estados persistidos no banco (tabela `estado_conversa`).

**Estados da conversa** (enum `EstadoBot`):

| Estado | Descrição |
|---|---|
| `inicio` | Estado inicial, aguardando intenção do usuário |
| `escolhendo_especialidade` | Paciente consultando profissionais disponíveis |
| `escolhendo_horario` | Paciente selecionando data/hora |
| `confirmando` | Aguardando confirmação explícita antes de criar agendamento |
| `concluido` | Agendamento criado, aguardando resposta ao opt-in de lembrete |
| `aguardando_resposta_lembrete` | Paciente respondendo ao lembrete automático |

**Fluxo 1 — Agendar Consulta** (`conversationService.js` linhas 323–559)
1. Bot lista profissionais disponíveis
2. Claude extrai especialidade desejada e `profissional_id`
3. Sistema consulta Google Calendar do profissional (fallback para mock se indisponível)
4. Formata e exibe 3 dias com até 8 horários cada
5. Claude extrai `data_hora` em ISO string
6. Valida conflito de agendamento antes de criar
7. Cria evento no Google Calendar
8. Apresenta opt-in de lembrete (1=Sim, 2=Não)

**Fluxo 2 — Remarcar Consulta** (linhas 560–688)
1. Detecta `agendamento_id` do contexto acumulado
2. Obtém slot anterior e novo horário
3. Cancela evento no Google Calendar do agendamento antigo
4. Cria novo evento para novo horário
5. Cancela job de lembrete antigo, agenda novo

**Fluxo 3 — Cancelar Consulta** (linhas 690–771)
1. Localiza agendamento via `agendamento_id` (fallback por profissional+data)
2. Marca como `status='cancelado'`
3. Remove evento do Google Calendar
4. Cancela job de lembrete com BullMQ

**Fluxo 4 — Responder ao Lembrete** (linhas 180–274)
- Menu sem IA: `1=Confirmar, 2=Remarcar, 3=Cancelar`
- Interpretado diretamente (não usa Claude)
- Confirmação atualiza status para `confirmado` e marca título no Calendar com ✅

**Fluxo 5 — Opt-in de Lembrete** (linhas 280–310)
- Pergunta se deseja lembrete 24h antes
- Atualiza `paciente.optInLembrete` conforme resposta
- Só agenda lembrete via BullMQ se confirmado

**Fluxo 6 — Perguntas Fora do Escopo** (linhas 414–437)
- Contador de incompreensão (`tentativas_sem_entendimento`)
- Após 3 mensagens incompreendidas consecutivas: reseta estado e sugere ligar para recepção
- Número de fallback configurável em `configJson.telefone_fallback`

### 1.2 Identificação de Paciente Novo vs Retorno

**Lógica em `conversationService.js` linhas 324–342**:

- **Novo**: primeiro agendamento do telefone, sem histórico
  - Claude pergunta: "Qual o seu nome completo?"
  - Aceita nomes com 2+ palavras
- **Retorno**: telefone já tem agendamentos
  - Exibe nomes conhecidos: "Essa consulta é para Maria ou Ana?"
  - Se novo nome → cria paciente adicional para mesmo telefone (familiar)
  - Se nome conhecido → usa paciente existente

### 1.3 Tratamento de Erros e Fallbacks

| Cenário | Tratamento |
|---|---|
| Google Calendar indisponível | Fallback para mock de slots (5 dias × 8 horários) |
| IA timeout (25s) | AbortController + controle genérico com `acao='nenhuma'` |
| Evolution API falha ao enviar | Retry automático 2× com delay de 1s |
| IA retorna JSON inválido | Fallback seguro: `intencao='outro'`, `confianca=0.0` |
| 3 mensagens incompreendidas | Reseta estado + oferece contato humano |

### 1.4 Lembretes Automáticos

**Sistema de 3 camadas**:

| Camada | Arquivo | Função |
|---|---|---|
| Worker de envio | `jobs/sendReminder.js` (173 linhas) | Processa a fila BullMQ e envia mensagem |
| Cron horário | `jobs/reminderScanner.js` (72 linhas) | Executa a cada 1h, enfileira jobs |
| Verificação de resposta | `jobs/checkReminderResponse.js` (55 linhas) | 4h após o lembrete, reseta estado se sem resposta |

**Timing**:
- Lembrete enviado **24h antes** da consulta
- Ajustado para dias úteis: sexta cobre sábado e domingo
- Janela do scanner: 23h–25h antes (sexta até 73h para cobrir segunda)
- Mínimo de 4h de antecedência para criar agendamento

**Agendamento do job**:
- Imediato: `scheduleReminderIfNeeded()` após confirmação (4h–25h antes)
- Horário: `reminderScannerWorker` (>25h antes, cobre os demais)
- Job ID: `reminder-{agendamentoId}` (deduplicação automática no BullMQ)

---

## 2. Painel Admin (da Clínica)

### 2.1 Páginas e Funcionalidades

| Página | Arquivo | Funcionalidades |
|---|---|---|
| Login | `Login.jsx` | Email + Senha, JWT em sessionStorage, redirect em 401 |
| Dashboard | `Dashboard.jsx` (6.9KB) | 3 cards métricas + tabela próximos 5 agendamentos |
| Agendamentos | `Agendamentos.jsx` (10.9KB) | Filtros, tabela paginada, ações por linha |
| Profissionais | `Profissionais.jsx` (12.1KB) | CRUD + binding Google Calendar |
| Configurações | `Configuracoes.jsx` (12.2KB) | Formulário config_json + status WhatsApp/Google |
| Conversas | `Conversas.jsx` (8.0KB) | Lista contatos + chat viewer |

### 2.2 Filtros e Ações por Página

**Dashboard**:
- Métrica 1: Agendamentos hoje
- Métrica 2: Agendamentos semana
- Métrica 3: Taxa de confirmação (30 dias)
- Tabela: próximos 5 com botões Confirmar/Cancelar

**Agendamentos**:
- Filtros: data_inicio, data_fim, profissional (dropdown), status (enum)
- Paginação: 20 por página
- Colunas: Data/Hora, Paciente, Profissional, Status, Ações
- Ações: Confirmar, Marcar Concluído, No-show, Cancelar

**Profissionais**:
- Tabela: Nome, Especialidade, Duração, Ativo
- Modal criar/editar: nome, especialidade, duração (mínimo 5 min)
- Botão "Vincular Google Calendar" → modal lista calendários disponíveis
- Toggle ativo/inativo

**Configurações**:
- Horário de funcionamento (seg–sex início/fim, sábado início/fim)
- Mensagem de boas-vindas (injetada no prompt do Claude)
- Telefone fallback (número para oferecer ao paciente perdido)
- Intervalo mínimo de slots (granularidade, default 30 min)
- Status do WhatsApp com botão "Mostrar QR Code"
- Status do Google Calendar com botão "Autorizar" (link OAuth)

**Conversas**:
- Barra de busca por nome/telefone
- Tabela: Telefone, Nome, Última Mensagem, Total
- Ao clicar: carrega chat no painel direito
- Chat: balões entrada (paciente) / saída (bot) com timestamps

### 2.3 Endpoints Backend do Admin

| Método | Rota | Função |
|---|---|---|
| POST | `/auth/login` | Login com rate limit 5/min |
| GET | `/admin/dashboard` | Métricas + próximos agendamentos |
| GET | `/admin/agendamentos` | Listagem com filtros e paginação |
| PUT | `/admin/agendamentos/:id/status` | Atualizar status |
| GET | `/admin/profissionais` | Listar profissionais |
| POST | `/admin/profissionais` | Criar profissional |
| PUT | `/admin/profissionais/:id` | Editar profissional |
| GET | `/admin/calendars/:clinicaId` | Listar Google Calendars |
| PUT | `/admin/profissionais/:id/calendar` | Vincular Google Calendar |
| GET | `/admin/configuracoes` | Ler configJson |
| PUT | `/admin/configuracoes` | Atualizar configJson |
| GET | `/admin/conversas/contatos` | Lista contatos únicos |
| GET | `/admin/conversas` | Histórico por telefone |
| GET | `/admin/google/auth/:clinicaId` | Inicia OAuth Google |
| GET | `/admin/google/callback` | Callback OAuth |
| GET | `/admin/google/status/:clinicaId` | Verifica conexão Google |
| POST | `/admin/instance/create` | Cria instância WhatsApp |
| GET | `/admin/instance/:clinicaId/qrcode` | QR code em base64 |

---

## 3. Painel Owner (Proprietário)

### 3.1 Páginas e Funcionalidades

| Página | Arquivo | Funcionalidades |
|---|---|---|
| Login | `Login.jsx` | Email + Senha, ownerToken em sessionStorage |
| Dashboard | `Dashboard.jsx` (5.0KB) | 4 cards + painel infra + alertas desconexão |
| Clínicas | `Clinicas.jsx` (16.0KB) | Tabela, busca, filtro, modal Nova Clínica, reset senha |
| Detalhe Clínica | `ClinicaDetalhe.jsx` (14.3KB) | Dados completos, profissionais (RO), integrações, ações |
| Instâncias | `Instancias.jsx` (9.3KB) | Tabela status WhatsApp, criar instância, ver QR |

### 3.2 O que Dá para Fazer Sem SQL

**Dashboard Owner**:
- Ver métricas globais: clínicas ativas/inativas, agendamentos hoje e semana
- Monitorar saúde da infraestrutura: DB, Redis, Evolution API (verde/vermelho)
- Ver alertas de WhatsApp desconectado por clínica com botão "Reconectar"

**Gerenciamento de Clínicas**:
- Criar nova clínica + usuário admin em transação atômica (sem SQL manual)
- Ativar/desativar clínica (toggle)
- Gerar nova senha aleatória para o admin da clínica (exibida apenas 1x)
- Ver detalhes completos: profissionais, status WhatsApp/Google Calendar

**Gerenciamento de Instâncias WhatsApp**:
- Ver status de todas as clínicas (conectado/desconectado/sem_instância)
- Criar nova instância WhatsApp para uma clínica
- Ver QR code para reconexão (modal com auto-refresh a cada 5s)

### 3.3 Endpoints Backend do Owner

| Método | Rota | Função |
|---|---|---|
| POST | `/owner/auth/login` | Login owner com rate limit 5/min |
| GET | `/owner/dashboard` | Métricas globais + saúde infra |
| GET | `/owner/clinicas` | Listar com filtros e paginação |
| POST | `/owner/clinicas` | Criar clínica + admin |
| GET | `/owner/clinicas/:id` | Detalhes completos |
| PUT | `/owner/clinicas/:id/toggle` | Ativar/desativar |
| POST | `/owner/clinicas/:id/reset-senha` | Gerar nova senha |
| GET | `/owner/instancias` | Status WhatsApp de todas as clínicas |
| POST | `/owner/instancias/:clinicaId/criar` | Criar instância |
| GET | `/owner/instancias/:clinicaId/qrcode` | QR code |

---

## 4. Integrações

### 4.1 WhatsApp — Evolution API

**Versão**: v2.1.1 (Docker)
**Implementação**: `/src/services/whatsappService.js` (124 linhas)

**Endpoints utilizados**:

| Endpoint | Uso |
|---|---|
| `POST /instance/create` | Cria instância com webhook configurado |
| `GET /instance/connect/{instanceName}` | Obtém QR code em base64 |
| `POST /message/sendText/{instanceName}` | Envia mensagem de texto |
| `GET /instance/connectionState/{instanceName}` | Verifica status da conexão |

**Webhook recebido**: `POST /webhook/whatsapp`
- Payload: `{ event, instance, data: { key, message } }`
- Filtros aplicados:
  - Ignora mensagens de si mesmo (`fromMe=true`)
  - Ignora grupos (`@g.us`) e broadcast
  - Ignora `@lid` (não suportado)
  - Ignora mensagens com mais de 30 min (downtime recovery)
  - Suporta whitelist via `TEST_PHONE_WHITELIST` (opcional, dev)

**Retry**: envio de mensagem tenta 2× com delay de 1s

### 4.2 Google Calendar

**Versão**: API v3 (googleapis)
**Implementação**: `/src/services/calendarService.js` (436 linhas), `/src/config/google.js` (82 linhas)

**O que sincroniza**:

| Operação | Quando |
|---|---|
| Consulta disponibilidade (freebusy) | Ao listar horários disponíveis para o paciente |
| Criar evento | Ao confirmar agendamento |
| Atualizar título do evento | Ao confirmar via lembrete (adiciona ✅) |
| Deletar evento | Ao cancelar agendamento |

**Configurações de slots**:
- Subtrai 2h de antecedência mínima dos horários disponíveis
- Granularidade configurável por profissional (`duracaoConsultaMin`)
- Filtra fins de semana
- Agrupa por dia com até 8 slots por dia

**Fallback**: se `calendarId` não vinculado ou Google indisponível → `generateMockSlots()` (5 dias × 8 horários)

### 4.3 Claude / OpenAI

**Modelo Claude**: `claude-sonnet-4-20250514`
**Modelo OpenAI**: `gpt-4o-mini`
**Implementação**: `/src/services/claudeService.js` (320 linhas), `/src/services/openaiService.js` (140 linhas)

**Como alterna entre providers**:
```
env.AI_PROVIDER = 'claude' (padrão) → claudeService.js
env.AI_PROVIDER = 'openai'          → openaiService.js
```

**System prompt inclui**:
- Identidade do bot + dados da clínica
- Lista de profissionais com especialidades e durações
- Slots disponíveis formatados
- Estado atual da máquina de estados
- Contexto acumulado (dados já coletados)
- Nomes conhecidos do telefone
- Agendamentos futuros confirmados (para remarcar/cancelar)
- Instrução de formato de resposta: JSON dentro de `<json>...</json>`

**Formato de resposta esperado**:
```json
{
  "mensagemParaPaciente": "...",
  "controle": {
    "intencao": "agendar|remarcar|cancelar|duvida|saudacao|outro",
    "novo_estado": "...",
    "dados_extraidos": {
      "especialidade": null,
      "profissional_id": null,
      "data_hora": null,
      "nome_paciente": null
    },
    "acao": "nenhuma|criar_agendamento|remarcar_agendamento|cancelar_agendamento",
    "confianca": 0.0
  }
}
```

**Timeout**: 25 segundos com AbortController

**Fallback (JSON inválido)**: `intencao='outro'`, `acao='nenhuma'`, `confianca=0.0`

---

## 5. Limitações Conhecidas

### 5.1 O que NÃO Funciona Ainda

| Feature | Status |
|---|---|
| Bloqueio de horários (férias, eventos) | ❌ Não implementado |
| Webhook de sincronização do Google Calendar | ❌ Não implementado (apenas polling) |
| Auditoria de ações do admin | ❌ Sem log de quem fez o quê |
| Agendamentos recorrentes | ❌ Apenas agendamentos únicos |
| Backup automático do banco | ❌ Sem rotina agendada |
| Multi-idioma | ❌ Apenas português brasileiro |
| SMS fallback | ❌ Apenas WhatsApp |
| Integração de pagamento | ❌ Sem cobrança |
| Editar data/hora de um agendamento (sem remarcar) | ❌ Apenas criar/remarcar/cancelar |

### 5.2 Funcionalidades Comentadas no Código

**Sugestão de contato por baixa confiança** (`conversationService.js` linhas 775–781):
```javascript
/*if ((controle.confianca ?? 1.0) < 0.6) {
  // adiciona sufixo "Se preferir, ligue para..."
}*/
```
- Desabilitado: julgou-se muito intrusivo; ativa apenas após 3 incompreensões

### 5.3 Bugs e Race Conditions Conhecidas

| Situação | Risco | Mitigação |
|---|---|---|
| Dois pacientes agendando o mesmo horário simultaneamente | Race condition entre validação e insert | `checkConflict()` antes do insert — risco residual em microseconds |
| Paciente responde ao lembrete enquanto está em fluxo ativo | Estado intermediário pode ser perdido | `sendReminder` verifica se estado é `['inicio', 'concluido']` antes de sobrescrever |

### 5.4 Dependências Externas Que Podem Falhar

| Componente | Modo de Falha | Tratamento |
|---|---|---|
| Evolution API | Servidor down, webhook timeout | Retry 2× na mensagem |
| Google Calendar | Quota esgotada, unauthorized | Fallback para mock de slots |
| Claude / OpenAI | Timeout, rate limit, parse error | Fallback seguro com controle genérico |
| PostgreSQL | Conexão perdida | `/health` retorna 503 |
| Redis | Conexão perdida | `/health` retorna 503; BullMQ falha sem retry |

---

## 6. Números Técnicos

### 6.1 Testes Automatizados

**Total**: 1.557 linhas de testes (Vitest)

| Arquivo de Teste | Linhas | O que Testa |
|---|---|---|
| `calendarService.test.js` | 372 | Parsing de freebusy, geração de slots, ajustes de timezone |
| `conversationService.test.js` | 609 | Máquina de estados, agendar, remarcar, cancelar, opt-in |
| `claudeService.test.js` | 236 | Parsing JSON, extração de mensagem, fallback sem JSON |
| `whatsapp.test.js` | 249 | Webhook payload parsing, whitelist, ignorar grupos |
| `phoneHelper.test.js` | 91 | Formatação de telefone (E.164, WhatsApp JID) |

**Executar**:
```bash
npm test          # executa uma vez
npm run test:watch # modo watch
```

### 6.2 Tabelas no Banco de Dados (Prisma / PostgreSQL 16)

**Total**: 8 models

| Model | Campos Principais | Relações |
|---|---|---|
| `Clinica` | id, nome, telefoneWpp (unique), configJson, googleRefreshToken, ativo | Profissional[], Paciente[], Agendamento[], Conversa[], EstadoConversa[], UsuarioAdmin[] |
| `Profissional` | id, clinicaId, nome, especialidade, calendarId, duracaoConsultaMin, ativo | Agendamento[] |
| `Paciente` | id, clinicaId, nome, telefone, optInLembrete | Agendamento[], Conversa[] |
| `Agendamento` | id, clinicaId, profissionalId, pacienteId, dataHora, duracaoMin, status, confirmedBy, calendarEventId, lembreteEnviadoAt, reminderJobId | Clinica, Profissional, Paciente |
| `Conversa` | id, clinicaId, pacienteId, telefone, direcao, mensagem, metadataJson | Clinica, Paciente |
| `EstadoConversa` | (telefone, clinicaId) PK composta, estado, contextoJson, updatedAt | Clinica |
| `UsuarioAdmin` | id, clinicaId, email (unique), senhaHash | Clinica |
| `UsuarioOwner` | id, email (unique), senhaHash | — |

**Enums**:
- `StatusAgendamento`: `agendado`, `confirmado`, `cancelado`, `concluido`, `no_show`
- `DirecaoConversa`: `entrada`, `saida`
- `EstadoBot`: `inicio`, `escolhendo_especialidade`, `escolhendo_horario`, `confirmando`, `concluido`, `aguardando_resposta_lembrete`

### 6.3 Todos os Endpoints da API

**Total**: 27 rotas + 1 health + 1 webhook

```
GET    /health                                     — health check (DB + Redis)
POST   /webhook/whatsapp                           — Evolution API webhook

AUTENTICAÇÃO
POST   /auth/login                                 — login admin (rate limit 5/min)
POST   /owner/auth/login                           — login owner (rate limit 5/min)

ADMIN — Dashboard
GET    /admin/dashboard                            — métricas clínica

ADMIN — Profissionais
GET    /admin/profissionais                        — listar
POST   /admin/profissionais                        — criar
PUT    /admin/profissionais/:id                    — editar
GET    /admin/calendars/:clinicaId                 — listar Google Calendars
PUT    /admin/profissionais/:id/calendar           — vincular Google Calendar

ADMIN — Agendamentos
GET    /admin/agendamentos                         — listar com filtros e paginação
PUT    /admin/agendamentos/:id/status              — atualizar status

ADMIN — Configurações
GET    /admin/configuracoes                        — ler configJson
PUT    /admin/configuracoes                        — atualizar configJson (merge)

ADMIN — Conversas
GET    /admin/conversas/contatos                   — lista contatos únicos
GET    /admin/conversas                            — histórico por telefone

ADMIN — Google Auth (OAuth2 Flow)
GET    /admin/google/auth/:clinicaId               — inicia redirecionamento OAuth
GET    /admin/google/callback                      — callback, salva refresh_token
GET    /admin/google/status/:clinicaId             — verifica se conectado

ADMIN — Instância WhatsApp
POST   /admin/instance/create                      — cria instância na Evolution
GET    /admin/instance/:clinicaId/qrcode           — retorna QR code em base64

OWNER — Dashboard
GET    /owner/dashboard                            — métricas globais + saúde infra

OWNER — Clínicas
GET    /owner/clinicas                             — listar com filtros e paginação
POST   /owner/clinicas                             — criar clínica + admin atomicamente
GET    /owner/clinicas/:id                         — detalhes completos
PUT    /owner/clinicas/:id/toggle                  — ativar/desativar
POST   /owner/clinicas/:id/reset-senha             — gerar nova senha (exibida 1x)

OWNER — Instâncias WhatsApp
GET    /owner/instancias                           — status WhatsApp de todas as clínicas
POST   /owner/instancias/:clinicaId/criar          — criar instância
GET    /owner/instancias/:clinicaId/qrcode         — QR code

DEV (NODE_ENV=development only)
POST   /dev/simulate                               — simula mensagem WhatsApp
```

### 6.4 Estatísticas de Código

| Componente | Arquivos | Linhas |
|---|---|---|
| Services | 7 | ~2.000 |
| Routes (backend) | 14 | ~1.520 |
| Jobs (BullMQ) | 3 | ~300 |
| Config | 5 | ~214 |
| Testes (Vitest) | 5 | 1.557 |
| Frontend Admin (React) | 6 páginas + contextos | ~40KB |
| Frontend Owner (React) | 5 páginas + contextos | ~35KB |
| **Total Backend** | | **~5.600 linhas** |

---

## Resumo Executivo

**AgendaZap** é um sistema de agendamento via WhatsApp para clínicas, composto por:

- **Bot Inteligente**: máquina de estados com IA (Claude/GPT-4o-mini) que agenda, remarca e cancela consultas em português, sem intervenção humana
- **Lembretes Automáticos**: sistema de 3 camadas com cron horário, fila BullMQ e verificação de resposta em 4h
- **Painel Admin**: CRUD de profissionais, configurações de clínica, histórico de conversas e integração com Google Calendar
- **Painel Owner**: gerenciamento multi-clínica sem SQL, reset de senha, monitoramento de infraestrutura
- **Integrações ativas**: Evolution API (WhatsApp v2.1.1), Google Calendar API v3, Claude/OpenAI
- **Testes**: 1.557 linhas de testes Vitest cobrindo máquina de estados, parsing de APIs e fallbacks
- **Endpoints**: 27 rotas REST + webhook + health check
- **Banco**: 8 models no PostgreSQL 16 via Prisma

**Status**: funcional para produção. Principais lacunas: bloqueio de horários no Calendar, auditoria de ações admin, e sincronização bidirecional com Google Calendar.
