Desenvolvimento local (o que você faz hoje pra subir o ambiente):
docker compose up -d          → Postgres, Redis, Evolution, Adminer
npm run dev (raiz)            → Backend Fastify  :3000
cd admin-panel && npm run dev → Painel React      :5173 (proxy → :3000)
  
# AgendaZap — Guia de Operação

Referência completa de comandos para operar o ambiente de desenvolvimento.
**Sistema operacional:** Windows com PowerShell
**Pasta do projeto:** `C:\agendaZap\agendazap`

---

## 1. SETUP INICIAL

> Execute estes passos apenas na primeira vez, na ordem indicada.

### 1.1 Instalar dependências Node.js

```powershell
cd C:\agendaZap\agendazap
npm install
```

**O que faz:** Instala todos os pacotes listados no `package.json`.
**Resultado esperado:** Pasta `node_modules` criada, sem erros.

---

### 1.2 Configurar variáveis de ambiente

```powershell
copy .env.example .env
```

Abra o `.env` e preencha as chaves reais:

| Variável | Onde obter |
|---|---|
| `CLAUDE_API_KEY` | console.anthropic.com |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | console.cloud.google.com → Credenciais → OAuth 2.0 |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/admin/google/callback` (deve ser cadastrado no Google Cloud) |
| `ADMIN_URL` | URL do painel admin (padrão: `http://localhost:5173`) |
| `JWT_SECRET` | Qualquer string longa e aleatória |

As demais variáveis já funcionam com os valores padrão do ambiente local.

---

### 1.3 Subir a infraestrutura Docker

```powershell
cd C:\agendaZap\agendazap
docker compose up -d
```

**O que faz:** Sobe PostgreSQL 16, Redis 7 e Evolution API v2.1.1 em background.
**Resultado esperado:** 3 containers com status `healthy`:

```powershell
docker ps
```

```
agendazap-postgres   ... healthy
agendazap-redis      ... healthy
agendazap-evolution  ... healthy
```

> Aguarde até 30 segundos para todos ficarem `healthy` na primeira vez.

---

### 1.4 Criar as tabelas no banco

```powershell
npm run db:push
```

**O que faz:** Sincroniza o schema Prisma com o PostgreSQL (schema `public`).
**Resultado esperado:** `Your database is now in sync with your Prisma schema.`

---

### 1.5 Popular dados de desenvolvimento

Antes de rodar, confirme que estas variáveis estão preenchidas no `.env`:

| Variável | Descrição |
|---|---|
| `CLINIC_PHONE` | Número WhatsApp da clínica (ex: `5561999990001`) — **obrigatório** |
| `CLINIC_NAME` | Nome da clínica (ex: `Clínica Saúde Plena`) |
| `ADMIN_EMAIL` | E-mail de acesso ao painel admin |
| `ADMIN_SENHA` | Senha do painel admin (mín. 6 chars; proibido `admin123` em produção) |

```powershell
cd C:\agendaZap\agendazap
node prisma/seed.js
```

**O que faz:** Cria (ou atualiza) a clínica com o `CLINIC_PHONE` do `.env`, o usuário admin e 3 profissionais de exemplo (só insere profissionais se a clínica ainda não tiver nenhum).
**Resultado esperado:**

```
✅ Seed concluído
   Clínica: Clínica Saúde Plena (ID: xxxxxxxx-...)
   Admin: admin@clinica.com
   Profissionais: 3 inseridos
```

> Seguro de rodar múltiplas vezes — usa `upsert`.

---

### 1.6 Iniciar o servidor backend

```powershell
npm run dev
```

**O que faz:** Sobe o servidor Fastify na porta 3000 com hot-reload.
**Resultado esperado:**

```
🚀 AgendaZap rodando em http://0.0.0.0:3000
```

---

### 1.7 Instalar dependências e iniciar o painel admin

```powershell
cd C:\agendaZap\agendazap\admin-panel
npm install
npm run dev
```

**O que faz:** Sobe o frontend React com Vite na porta 5173.
**Resultado esperado:**

```
  VITE v6.x.x  ready in ...ms
  ➜  Local:   http://localhost:5173/
```

Abra `http://localhost:5173` no navegador e faça login com as credenciais definidas em `ADMIN_EMAIL` / `ADMIN_SENHA`.

> O painel só funciona com o servidor backend rodando (passo 1.6). As chamadas de API são proxiadas automaticamente pelo Vite para `localhost:3000`.

---

## 2. DIA A DIA

### 2.1 Subir os containers Docker

```powershell
cd C:\agendaZap\agendazap
docker compose start
```

**Quando usar:** Após reiniciar o computador ou após `docker compose stop`.
**Resultado esperado:** `Container agendazap-postgres  Started` (e os demais).

---

### 2.2 Parar os containers Docker

```powershell
cd C:\agendaZap\agendazap
docker compose stop
```

**Quando usar:** Para liberar recursos quando não estiver usando o projeto.
**Resultado esperado:** `Container agendazap-evolution  Stopped` (e os demais).
**Dados preservados:** Sim — volumes não são removidos.

---

### 2.3 Rodar os testes automatizados

```powershell
cd C:\agendaZap\agendazap
npm test
```

**O que faz:** Executa os 71 testes com Vitest (sem subir servidor, sem acessar banco ou APIs externas — tudo mockado).
**Resultado esperado:**
```
 Test Files  5 passed (5)
      Tests  71 passed (71)
```

**Modo watch** (re-executa ao salvar um arquivo):
```powershell
npm run test:watch
```

---

### 2.4 Iniciar o painel admin

```powershell
cd C:\agendaZap\agendazap\admin-panel
npm run dev
```

**Quando usar:** Para acessar o painel administrativo no browser.
**URL:** http://localhost:5173
**Login:** e-mail e senha do `.env` (`ADMIN_EMAIL` / `ADMIN_SENHA`)
**Terminal:** Deixe este terminal aberto — o Vite exibe erros de build aqui.

---

### 2.5 Iniciar o servidor do bot

```powershell
cd C:\agendaZap\agendazap
npm run dev
```

**Quando usar:** Toda vez que quiser que o bot responda mensagens.
**Terminal:** Deixe este terminal aberto — os logs aparecem aqui em tempo real.

---

### 2.6 Parar o servidor do bot

```powershell
taskkill /IM node.exe /F
```

**Quando usar:** Para desativar o bot (celular voltará a responder normalmente).
**Resultado esperado:** `ÊXITO: o processo "node.exe" foi finalizado.`

> Se tiver outros processos Node.js rodando que não quer matar, use o PID específico:
> ```powershell
> netstat -ano | findstr :3000   # anota o PID
> taskkill /PID <PID> /F
> ```

---

### 2.7 Reiniciar o servidor do bot

```powershell
taskkill /IM node.exe /F; cd C:\agendaZap\agendazap; npm run dev
```

**Quando usar:** Após alterações no código que o nodemon não recarregou automaticamente.

---

### 2.8 Verificar se está tudo rodando (health check)

```powershell
curl http://localhost:3000/health
```

**Resultado esperado:**
```json
{ "status": "ok", "services": { "db": true, "redis": true } }
```

Se `"status": "degraded"`, algum serviço está fora. Verifique com `docker ps`.

---

### 2.9 Ver logs do servidor em tempo real

O servidor exibe logs diretamente no terminal onde `npm run dev` está rodando.

Para filtrar apenas erros:

```powershell
npm run dev 2>&1 | Select-String "ERROR"
```

---

### 2.10 Ver logs da Evolution API

```powershell
docker logs agendazap-evolution --tail 50
```

**Com follow (tempo real):**
```powershell
docker logs agendazap-evolution --follow
```

**Filtrar apenas erros:**
```powershell
docker logs agendazap-evolution --tail 100 2>&1 | Select-String "ERROR"
```

---

## 3. WHATSAPP / EVOLUTION API

> Para os comandos abaixo, você precisa do ID da clínica. Obtenha-o via Prisma Studio (seção 4.1).
>
> As rotas `/admin/instance/*` exigem autenticação JWT. Obtenha o token antes de rodar os comandos:
> ```powershell
> $TOKEN = (Invoke-RestMethod -Uri "http://localhost:3000/auth/login" `
>   -Method POST -ContentType "application/json" `
>   -Body '{"email":"SEU_EMAIL","senha":"SUA_SENHA"}').data.token
> ```

### 3.1 Criar instância WhatsApp para uma clínica

```powershell
curl -X POST http://localhost:3000/admin/instance/create `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $TOKEN" `
  -d '{"clinicaId": "ID_DA_CLINICA"}'
```

**O que faz:** Registra a clínica na Evolution API usando o telefone dela como nome da instância.
**Resultado esperado:** JSON com dados da instância criada e QR code base64.

---

### 3.2 Gerar QR code para conectar o WhatsApp

```powershell
curl -H "Authorization: Bearer $TOKEN" `
  http://localhost:3000/admin/instance/ID_DA_CLINICA/qrcode
```

**O que faz:** Retorna o QR code para escanear com o celular da clínica.
**Como usar o QR:** O campo `code` na resposta é o conteúdo do QR. Cole em qualquer gerador online (ex: `qr-code-generator.com`) para visualizar a imagem.

**Alternativa visual:** Acesse o Evolution Manager em `http://localhost:8080/manager` (credencial: a `EVOLUTION_API_KEY` do `.env`).

---

### 3.3 Verificar status da conexão WhatsApp

```powershell
curl -H "Authorization: Bearer $TOKEN" `
  http://localhost:3000/admin/instance/ID_DA_CLINICA/status
```

**Resultado esperado quando conectado:**
```json
{ "state": "open" }
```

| Estado | Significado |
|---|---|
| `open` | Conectado e funcionando |
| `connecting` | Aguardando scan do QR code |
| `close` | Desconectado |

---

### 3.4 Listar todas as instâncias ativas

```powershell
curl -H "apikey: agendazap-dev-key" http://localhost:8080/instance/fetchInstances
```

**O que faz:** Retorna todas as instâncias registradas na Evolution API com status de conexão.

---

### 3.5 Desconectar uma instância (logout)

```powershell
curl -X DELETE `
  -H "apikey: agendazap-dev-key" `
  http://localhost:8080/instance/logout/NOME_DA_INSTANCIA
```

Onde `NOME_DA_INSTANCIA` é o telefone da clínica (ex: `5561995535135`).

**O que faz:** Desconecta o WhatsApp. Para reconectar, gere um novo QR code (passo 3.2).

---

### 3.6 Deletar uma instância permanentemente

```powershell
curl -X DELETE `
  -H "apikey: agendazap-dev-key" `
  http://localhost:8080/instance/delete/NOME_DA_INSTANCIA
```

> ⚠️ Irreversível. Use apenas para remover instâncias antigas/incorretas.

---

### 3.7 Acessar o painel Evolution Manager

Abra no navegador: **http://localhost:8080/manager**

- **API Key:** `agendazap-dev-key` (valor de `EVOLUTION_API_KEY` no `.env`)
- Permite visualizar instâncias, QR codes, mensagens e status de conexão graficamente.

---

## 4. CLAUDE API / IA

### 4.1 Testar a Claude API diretamente

Verifica se a `CLAUDE_API_KEY` está válida e a API responde:

```powershell
cd C:\agendaZap\agendazap
node -e "
import('./src/services/claudeService.js').then(async ({ processMessage }) => {
  const r = await processMessage('Quero agendar uma consulta', 'Você é assistente de clínica.', [], 'inicio');
  console.log('Resposta:', r.mensagemParaPaciente);
});
"
```

**Resultado esperado:** Uma mensagem de saudação/boas-vindas do bot sem erros.
**Se retornar** `"estou com uma instabilidade momentânea"`: verifique a `CLAUDE_API_KEY` no `.env`.

---

### 4.2 Ver histórico de conversas de um número

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT direcao, mensagem, created_at FROM public.conversas WHERE telefone = 'NUMERO' ORDER BY created_at;"
```

Substitua `NUMERO` pelo telefone sem formatação (ex: `5561999990001` ou o identificador `@lid` sem o sufixo).

**Via Prisma Studio (visual):**
```powershell
cd C:\agendaZap\agendazap
npx prisma studio
```
Acesse `http://localhost:5555` → tabela `Conversa` → filtre por `telefone`.

---

### 4.3 Ver estado atual de uma conversa

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT telefone, estado, contexto_json, updated_at FROM public.estado_conversa ORDER BY updated_at DESC LIMIT 10;"
```

Mostra em que etapa do fluxo cada paciente está e os dados já coletados (especialidade, horário, nome).

---

### 4.4 Resetar estado de uma conversa (forçar reinício)

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE public.estado_conversa SET estado = 'inicio', contexto_json = '{}' WHERE telefone = 'NUMERO';"
```

**Quando usar:** Quando uma conversa travar em estado inconsistente durante testes.

---

### 4.5 Ver agendamentos criados pelo bot

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT a.id, p.nome AS paciente, pr.nome AS profissional, a.data_hora, a.status FROM public.agendamentos a JOIN public.pacientes p ON p.id = a.paciente_id JOIN public.profissionais pr ON pr.id = a.profissional_id ORDER BY a.data_hora;"
```

---

## 5. BANCO DE DADOS

### 5.1 Acessar o banco via Prisma Studio (interface visual)

```powershell
cd C:\agendaZap\agendazap
npx prisma studio
```

**O que faz:** Abre uma interface web em `http://localhost:5555` para visualizar e editar os dados.
**Resultado esperado:** Navegador abre com as tabelas do banco.

---

### 5.2 Sincronizar schema com o banco (sem criar migration)

```powershell
npm run db:push
```

**Quando usar:** Durante desenvolvimento, após alterar o `prisma/schema.prisma`.
**Atenção:** Pode apagar dados se remover campos. Use `db:migrate` em produção.

---

### 5.3 Criar e aplicar uma migration nomeada

```powershell
npm run db:migrate
```

Será solicitado um nome para a migration (ex: `add_campo_observacoes`).
**Quando usar:** Para registrar alterações de schema de forma versionada.

---

### 5.4 Re-executar o seed (repopular dados de teste)

```powershell
npm run db:seed
```

> O seed usa `upsert` — seguro de rodar múltiplas vezes sem duplicar dados.

---

### 5.5 Resetar banco de desenvolvimento (apaga tudo)

```powershell
npx prisma migrate reset --force
```

**O que faz:** Dropa todas as tabelas, recria o schema e roda o seed automaticamente.
**Quando usar:** Para partir de um estado limpo durante desenvolvimento.
> ⚠️ Apaga todos os dados. Nunca use em produção.

---

### 5.6 Acessar o PostgreSQL diretamente via psql

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap
```

**Comandos úteis dentro do psql:**

```sql
\dt public.*          -- lista tabelas do schema público
\dt evolution.*       -- lista tabelas da Evolution API
SELECT * FROM public.clinicas;
\q                    -- sair
```

---

## 5. GOOGLE CALENDAR

> As rotas `/admin/google/status/*`, `/admin/calendars/*` e `/admin/profissionais/*/calendar`
> exigem autenticação JWT. Se ainda não tiver o token, obtenha-o (veja início da seção 3).

### 5.1 Verificar se a clínica tem Google Calendar autorizado

```powershell
curl -H "Authorization: Bearer $TOKEN" `
  http://localhost:3000/admin/google/status/ID_DA_CLINICA
```

**Resultado esperado quando autorizado:**
```json
{ "success": true, "data": { "conectado": true } }
```

Se `"conectado": false`, execute o passo 5.2.

---

### 5.2 Autorizar Google Calendar (fluxo OAuth)

Abra no navegador:
```
http://localhost:3000/admin/google/auth/ID_DA_CLINICA
```

Faça login com a conta Google que tem os calendários dos profissionais → clique em **Permitir**.

O navegador vai redirecionar para:
```
http://localhost:5173/?google_auth=success&clinicaId=ID_DA_CLINICA
```

Se aparecer `google_auth=error&reason=...`, o campo `reason` na URL indica o problema (veja Troubleshooting seção 6).

---

### 5.3 Listar calendários disponíveis da conta Google

```powershell
curl -H "Authorization: Bearer $TOKEN" `
  http://localhost:3000/admin/calendars/ID_DA_CLINICA | Select-Object -ExpandProperty Content
```

Retorna a lista de calendários da conta Google conectada com `id` e `summary`.

---

### 5.4 Vincular um calendar a um profissional

```powershell
curl -X PUT http://localhost:3000/admin/profissionais/ID_DO_PROFISSIONAL/calendar `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $TOKEN" `
  -d '{\"calendarId\": \"ID_DO_CALENDAR\"}'
```

**Onde obter os IDs:**
- `ID_DO_PROFISSIONAL` — via Prisma Studio (`npx prisma studio`) → tabela `Profissional`
- `ID_DO_CALENDAR` — pelo comando 5.3 acima

**Resultado esperado:**
```json
{ "success": true, "data": { "id": "...", "calendarId": "...", ... } }
```

---

### 5.5 Verificar agendamentos com evento criado no Calendar

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT a.id, pa.nome AS paciente, pr.nome AS profissional, a.data_hora, a.status, a.calendar_event_id FROM agendamentos a JOIN pacientes pa ON pa.id = a.paciente_id JOIN profissionais pr ON pr.id = a.profissional_id ORDER BY a.created_at DESC LIMIT 10;"
```

- `calendar_event_id` preenchido = evento criado com sucesso no Google Calendar
- `calendar_event_id` nulo = evento não foi criado (verifique os logs do servidor)

---

### 5.6 IDs dos recursos de desenvolvimento (seed)

> Os UUIDs abaixo são do banco de desenvolvimento local. Se você apagou e refez o banco, os IDs mudaram — consulte via Prisma Studio (`npx prisma studio`) ou pelo painel admin.

| Recurso | UUID |
|---|---|
| Dr. João Silva | `e9969385-9733-4d03-aee4-87989cfa4d2f` |
| Dra. Maria Santos | `8cec83b8-3496-4d8c-8468-2bf2bacedfcd` |
| Dra. Ana Costa | `c4f2d409-cfc6-4bb9-9008-676070182748` |
| Clínica Saúde Plena | `cf998d93-a395-4a04-9500-91ffb5bb2e56` |

**Verificar IDs pelo banco:**
```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT id, nome, telefone_wpp FROM clinicas;"
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT id, nome FROM profissionais ORDER BY nome;"
```

---

## 6. LEMBRETES AUTOMÁTICOS

### 6.1 Como funciona o sistema de lembretes

- **Cron horário:** a cada 1h o sistema varre agendamentos confirmados nas próximas 23–25h (sexta-feira: 23–73h para cobrir segunda) com `opt_in_lembrete = true` e `lembrete_enviado_at IS NULL`
- **Envio:** 24h antes da consulta (ou na sexta se o momento cair no fim de semana)
- **Resposta:** o paciente responde 1 (confirma), 2 (remarca) ou 3 (cancela) — o bot interpreta diretamente sem chamar IA
- **Não-resposta:** 4h após o lembrete, o estado é resetado para `inicio` automaticamente

---

### 6.2 Verificar lembretes pendentes

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT a.id, pa.nome AS paciente, pr.nome AS profissional, a.data_hora, a.lembrete_enviado_at, a.reminder_job_id FROM agendamentos a JOIN pacientes pa ON pa.id = a.paciente_id JOIN profissionais pr ON pr.id = a.profissional_id WHERE a.status = 'confirmado' AND a.data_hora > NOW() ORDER BY a.data_hora;"
```

- `lembrete_enviado_at` preenchido = lembrete já enviado
- `reminder_job_id` preenchido = job aguardando na fila do Redis

---

### 6.3 Ver opt-in de lembrete dos pacientes

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT nome, telefone, opt_in_lembrete FROM pacientes ORDER BY created_at DESC LIMIT 20;"
```

---

### 6.4 Alterar opt-in manualmente (caso necessário)

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE pacientes SET opt_in_lembrete = false WHERE telefone = 'NUMERO';"
```

---

### 6.5 Ver pacientes aguardando resposta ao lembrete

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT ec.telefone, ec.estado, ec.contexto_json, ec.updated_at FROM estado_conversa ec WHERE ec.estado = 'aguardando_resposta_lembrete';"
```

---

### 6.6 Resetar paciente preso em aguardando_resposta_lembrete

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE estado_conversa SET estado = 'inicio', contexto_json = '{}' WHERE telefone = 'NUMERO' AND estado = 'aguardando_resposta_lembrete';"
```

---

## 8. PAINEL ADMINISTRATIVO

### 8.1 Acessar o painel

1. Certifique-se de que o servidor backend está rodando (`npm run dev` na raiz)
2. Na pasta `admin-panel`, rode `npm run dev`
3. Abra **http://localhost:5173** no navegador
4. Faça login com `ADMIN_EMAIL` e `ADMIN_SENHA` do `.env`

---

### 8.2 Navegar pelas seções

| Seção | O que oferece |
|---|---|
| **Dashboard** | Agendamentos do dia e da semana, taxa de confirmação (30 dias), próximos 5 agendamentos com ações rápidas |
| **Agendamentos** | Listagem com filtros por data, profissional e status; ações por linha (concluir / no-show / cancelar) |
| **Profissionais** | Criar, editar, desativar profissionais; vincular Google Calendar por profissional |
| **Configurações** | Horários de funcionamento, mensagem de boas-vindas, telefone de fallback, status WhatsApp e Google Calendar |
| **Conversas** | Lista de contatos com última mensagem; ao clicar abre o histórico em formato de chat (balões bot/paciente) |

---

### 8.3 Cancelar um agendamento pelo painel

1. Abra a aba **Agendamentos**
2. Localize o agendamento (use filtros de data ou profissional se necessário)
3. Clique em **Cancelar** na linha correspondente
4. O sistema:
   - Atualiza o status no banco para `cancelado`
   - Remove o evento do Google Calendar do profissional
   - Cancela o job de lembrete no BullMQ (se houver)

---

### 8.4 Vincular Google Calendar a um profissional

1. Abra a aba **Profissionais**
2. Clique no ícone de calendário na linha do profissional
3. O modal lista os calendários disponíveis na conta Google já conectada
4. Selecione o calendário desejado e confirme

> Pré-requisito: a clínica precisa ter o Google Calendar autorizado (aba **Configurações** → seção Google Calendar → botão "Autorizar").

---

### 8.5 Verificar/reconectar WhatsApp pelo painel

1. Abra a aba **Configurações**
2. Seção **WhatsApp** mostra o estado atual: `Conectado` (verde) ou `Desconectado` (vermelho)
3. Se desconectado, clique em **Gerar QR Code**, escaneie com o celular da clínica e aguarde alguns segundos
4. Recarregue a página para confirmar o novo status

---

### 8.6 Trocar senha do admin (via banco)

Não há tela de trocar senha no painel — faça via banco:

```powershell
# Gerar hash bcrypt para a nova senha (rode no terminal da raiz do projeto)
node -e "import('bcrypt').then(({default:b})=>b.hash('NOVA_SENHA',12).then(console.log))"
```

```powershell
# Atualizar no banco
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE usuarios_admin SET senha_hash = 'HASH_GERADO' WHERE email = 'admin@clinica.com';"
```

---

### 8.7 Criar um segundo usuário admin

```powershell
node -e "import('bcrypt').then(({default:b})=>b.hash('SENHA',12).then(h=>console.log(h)))"
```

```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "
INSERT INTO usuarios_admin (id, clinica_id, email, senha_hash)
VALUES (gen_random_uuid(), 'ID_DA_CLINICA', 'outro@clinica.com', 'HASH');
"
```

---

## 7. TROUBLESHOOTING

### O bot não responde às mensagens

**Passo 1 — Verifique se o servidor está rodando:**
```powershell
curl http://localhost:3000/health
```
Se falhar: `npm run dev`

**Passo 2 — Verifique se o WhatsApp está conectado:**
```powershell
curl -H "Authorization: Bearer $TOKEN" `
  http://localhost:3000/admin/instance/ID_DA_CLINICA/status
```
Se não for `open`: gere novo QR code e escaneie novamente.

**Passo 3 — Confirme a URL do webhook na instância:**
```powershell
curl -H "apikey: agendazap-dev-key" http://localhost:8080/webhook/find/NOME_DA_INSTANCIA
```
O campo `url` deve ser `http://host.docker.internal:3000/webhook/whatsapp`.
Se estiver errado, corrija:
```powershell
curl -X POST http://localhost:8080/webhook/set/NOME_DA_INSTANCIA `
  -H "Content-Type: application/json" `
  -H "apikey: agendazap-dev-key" `
  -d '{"webhook":{"enabled":true,"url":"http://host.docker.internal:3000/webhook/whatsapp","webhookByEvents":false,"webhookBase64":false,"events":["MESSAGES_UPSERT"]}}'
```

**Passo 4 — Verifique os logs da Evolution API:**
```powershell
docker logs agendazap-evolution --tail 30
```
Procure por `ECONNREFUSED` (servidor parado), `ENOTFOUND` (URL errada) ou `status code 413` (payload muito grande — indica `bodyLimit` insuficiente no Fastify).

**Passo 5 — Verifique se a Claude API está respondendo:**
```powershell
node -e "import('./src/services/claudeService.js').then(async({processMessage})=>{const r=await processMessage('oi','Assistente de clínica.',[]);console.log(r.mensagemParaPaciente);})"
```

---

### O Docker não sobe

**Verifique se o Docker Desktop está rodando:**
Procure o ícone do Docker na barra de tarefas. Se não estiver, abra o Docker Desktop e aguarde inicializar.

**Veja o erro específico de cada container:**
```powershell
docker compose logs postgres
docker compose logs redis
docker compose logs evolution-api
```

**Porta em uso (ex: 5432 ocupada):**
```powershell
netstat -ano | findstr :5432
taskkill /PID <PID> /F
```

**Reconstruir do zero (último recurso):**
```powershell
docker compose down -v
docker compose up -d
npm run db:push
npm run db:seed
```
> ⚠️ `-v` remove os volumes — apaga todos os dados.

---

### O QR code não gera

**Causa mais comum:** Instância já existe ou está em estado inconsistente.

**Passo 1 — Verifique o estado da instância:**
```powershell
curl -H "apikey: agendazap-dev-key" http://localhost:8080/instance/fetchInstances
```

**Passo 2 — Se `connectionStatus` não for `connecting`, faça logout:**
```powershell
curl -X DELETE -H "apikey: agendazap-dev-key" http://localhost:8080/instance/logout/NOME_DA_INSTANCIA
```

**Passo 3 — Tente gerar o QR novamente:**
```powershell
curl -H "Authorization: Bearer $TOKEN" `
  http://localhost:3000/admin/instance/ID_DA_CLINICA/qrcode
```

**Se ainda não funcionar — delete e recrie a instância:**
```powershell
curl -X DELETE -H "apikey: agendazap-dev-key" http://localhost:8080/instance/delete/NOME_DA_INSTANCIA

curl -X POST http://localhost:3000/admin/instance/create `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $TOKEN" `
  -d '{"clinicaId": "ID_DA_CLINICA"}'
```

---

### Erro no OAuth do Google Calendar (`google_auth=error`)

O campo `reason` na URL de redirecionamento indica a causa:

| `reason` | Causa | Solução |
|---|---|---|
| `invalid_client` | `GOOGLE_CLIENT_ID` ou `GOOGLE_CLIENT_SECRET` incorreto no `.env` | Verifique os valores no Google Cloud Console → Credenciais |
| `redirect_uri_mismatch` | A URI de callback não está cadastrada no Google Cloud | Adicione `http://localhost:3000/admin/google/callback` em **URIs de redirecionamento autorizados** |
| `invalid_grant` | O `code` OAuth expirou ou já foi usado | Acesse `/admin/google/auth/ID` novamente para gerar novo code |
| `access_denied` | Usuário clicou em "Cancelar" na tela de consentimento | Repita o fluxo e clique em **Permitir** |
| Erro Prisma `googleRefreshToken` | Prisma Client desatualizado | Rode `npm run db:push` e reinicie o servidor |

---

### Bot enviou muitas mensagens ao subir o servidor

**Causa:** mensagens acumuladas durante downtime foram processadas de uma vez.
**Prevenção:** o webhook agora ignora mensagens com mais de 30 minutos. Esse comportamento está ativo automaticamente.
**Se acontecer novamente:** verifique o log do servidor — cada mensagem ignorada aparece como:
```
Mensagem ignorada — muito antiga (downtime) | idadeMin: XX
```

---

### Token do Google Calendar expirou (`invalid_grant`)

**Sintoma:** agendamentos são criados no banco mas não aparecem no Google Calendar. O log mostra:
```
[criar_agendamento] Falha: invalid_grant
```

**Causa:** apps Google em modo "Teste" no Google Cloud têm tokens que expiram a cada 7 dias.

**Solução imediata** — reautorizar pelo browser:
```
http://localhost:3000/admin/google/auth/ID_DA_CLINICA
```

**Solução definitiva** — publicar o app no Google Cloud Console:
1. Acesse [console.cloud.google.com](https://console.cloud.google.com) → OAuth consent screen
2. Mude de **Testing** para **In production**
3. Tokens não expirarão mais em 7 dias

---

### Agendamento confirmado mas evento não aparece no Google Calendar

**Passo 1 — Verifique se o `calendar_event_id` foi salvo:**
```powershell
docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT id, calendar_event_id, data_hora FROM agendamentos ORDER BY created_at DESC LIMIT 3;"
```
Se `calendar_event_id` for NULL, o `createEvent` falhou silenciosamente.

**Passo 2 — Veja os logs do servidor** no terminal onde `npm run dev` está rodando. Procure por:
```
Erro ao criar agendamento: ...
Contexto no momento do erro: ...
```

**Causas comuns:**
- `profissional_id` no contexto não é um UUID válido → Claude sem UUID no prompt (bug corrigido na Etapa 4)
- Profissional sem `calendarId` vinculado → execute o passo 5.4
- Token Google expirado → repita o passo 5.2

---

### Como verificar se o webhook está recebendo mensagens

**Simule um webhook manualmente do terminal:**
```powershell
curl -X POST http://localhost:3000/webhook/whatsapp `
  -H "Content-Type: application/json" `
  --data-raw '{\"event\":\"messages.upsert\",\"instance\":\"NOME_DA_INSTANCIA\",\"data\":{\"key\":{\"remoteJid\":\"5511999990001@s.whatsapp.net\",\"fromMe\":false,\"id\":\"TEST001\"},\"message\":{\"conversation\":\"Teste\"}}}'
```

**Resultado esperado:** `{"received":true}` e uma mensagem de resposta enviada para `5511999990001`.

**Verifique se chegou no banco:**
```powershell
cd C:\agendaZap\agendazap
npx prisma studio
```
Acesse a tabela `conversas` — deve haver registros `entrada` e `saida` recentes.

**Teste conectividade Docker → servidor:**
```powershell
docker exec agendazap-evolution wget -q -O- http://host.docker.internal:3000/health
```
Resultado esperado: `{"status":"ok",...}`

---

---

## Simulador de Mensagens (sem WhatsApp real)

O simulador permite testar o bot completo — incluindo Claude AI, banco de dados e Google Calendar — sem precisar de celular nem créditos desnecessários de infraestrutura.

**Pré-requisito:** servidor rodando com `NODE_ENV=development` (padrão do `npm run dev`).

---

### Endpoints disponíveis

| Rota | Método | Descrição |
|---|---|---|
| `/dev/simulate` | POST | Envia mensagem e recebe resposta do bot |
| `/dev/simulate/state/:phone` | GET | Ver estado atual da conversa |
| `/dev/simulate/reset/:phone` | GET | Resetar conversa para o início |

> Esses endpoints retornam **404** se `NODE_ENV` não for `development`.

---

### Passo 1 — Enviar mensagem e ver resposta

```powershell
# Troque o "phone" pelo número que quiser usar como paciente de teste
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"phone":"5561999990002","message":"Oi"}' | Select-Object -ExpandProperty Content
```

**Resposta esperada:**
```json
{
  "success": true,
  "data": {
    "mensagemRecebida": "Oi",
    "respostaBot": "Olá! Bem-vindo à Clínica...",
    "estadoConversa": "escolhendo_especialidade",
    "contexto": {}
  }
}
```

---

### Passo 2 — Continuar a conversa (mesmas chamadas em sequência)

```powershell
# Mensagem 1: iniciar
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate" `
  -Method POST -ContentType "application/json" `
  -Body '{"phone":"5561999990002","message":"Oi"}' | Select-Object -ExpandProperty Content

# Mensagem 2: escolher especialidade
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate" `
  -Method POST -ContentType "application/json" `
  -Body '{"phone":"5561999990002","message":"Quero consulta com cardiologista"}' | Select-Object -ExpandProperty Content

# Mensagem 3: escolher horário (use um horário que o bot sugeriu)
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate" `
  -Method POST -ContentType "application/json" `
  -Body '{"phone":"5561999990002","message":"Quero segunda às 10h"}' | Select-Object -ExpandProperty Content

# Mensagem 4: confirmar
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate" `
  -Method POST -ContentType "application/json" `
  -Body '{"phone":"5561999990002","message":"Confirmo. Meu nome é João Silva"}' | Select-Object -ExpandProperty Content
```

---

### Passo 3 — Inspecionar o estado da conversa

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate/state/5561999990002" `
  -Method GET | Select-Object -ExpandProperty Content
```

**Retorna:** estado atual, contexto acumulado, últimas 10 mensagens e agendamentos criados.

---

### Passo 4 — Resetar e recomeçar do zero

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate/reset/5561999990002" `
  -Method GET | Select-Object -ExpandProperty Content
```

**Retorna:** estado anterior, confirmação do reset e número de agendamentos removidos.

---

### Verificar no banco de dados

Após simular, verifique os registros no Prisma Studio:

```powershell
npx prisma studio
```

Acesse `http://localhost:5555` e inspecione:
- Tabela `Conversa` — mensagens de entrada e saída salvas
- Tabela `EstadoConversa` — estado e contexto acumulado
- Tabela `Agendamento` — agendamentos criados pela simulação

---

## Referência Rápida

| Ação | Comando / URL |
|---|---|
| **Painel admin** | http://localhost:5173 (login: ADMIN_EMAIL/ADMIN_SENHA) |
| Iniciar painel admin | `cd admin-panel && npm run dev` |
| Iniciar servidor bot | `cd C:\agendaZap\agendazap && npm run dev` |
| Subir infra Docker | `docker compose start` |
| Parar bot | `taskkill /IM node.exe /F` |
| Parar tudo | `taskkill /IM node.exe /F && docker compose stop` |
| Health check | `curl http://localhost:3000/health` |
| Rodar testes | `npm test` |
| Simular mensagem (dev) | `Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate" -Method POST -ContentType "application/json" -Body '{"phone":"5561999990002","message":"Oi"}' \| Select-Object -ExpandProperty Content` |
| Ver estado simulação (dev) | `Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate/state/5561999990002" -Method GET \| Select-Object -ExpandProperty Content` |
| Resetar simulação (dev) | `Invoke-WebRequest -Uri "http://localhost:3000/dev/simulate/reset/5561999990002" -Method GET \| Select-Object -ExpandProperty Content` |
| Status WhatsApp | `curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/instance/ID/status` |
| Painel Evolution | http://localhost:8080/manager |
| Prisma Studio | `npx prisma studio` → http://localhost:5555 |
| Logs do bot | Terminal onde `npm run dev` está rodando |
| Logs Evolution | `docker logs agendazap-evolution --tail 50` |
| Ver conversas (banco) | `npx prisma studio` → tabela `Conversa` |
| Ver estado das conversas | `docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT telefone, estado, updated_at FROM public.estado_conversa ORDER BY updated_at DESC LIMIT 10;"` |
| Resetar conversa travada | `docker exec agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE public.estado_conversa SET estado='inicio', contexto_json='{}' WHERE telefone='NUMERO';"` |
| Lembretes pendentes | `docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT pa.nome, a.data_hora, a.lembrete_enviado_at FROM agendamentos a JOIN pacientes pa ON pa.id=a.paciente_id WHERE a.status='confirmado' AND a.data_hora > NOW() ORDER BY a.data_hora;"` |
| Pacientes em aguardando lembrete | `docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT telefone, updated_at FROM estado_conversa WHERE estado='aguardando_resposta_lembrete';"` |
| Reautorizar Google (token expirado) | Abrir no browser: `http://localhost:3000/admin/google/auth/ID_DA_CLINICA` |
| Status OAuth Google | `curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/google/status/ID_DA_CLINICA` |
| Listar calendários Google | `curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/calendars/ID_DA_CLINICA \| Select-Object -ExpandProperty Content` |
| Ver agendamentos + calendar_event_id | `docker exec agendazap-postgres psql -U agendazap -d agendazap -c "SELECT pa.nome, pr.nome, a.data_hora, a.calendar_event_id FROM agendamentos a JOIN pacientes pa ON pa.id=a.paciente_id JOIN profissionais pr ON pr.id=a.profissional_id ORDER BY a.created_at DESC LIMIT 5;"` |
