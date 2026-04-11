# AgendaZap — Checklist de Onboarding de Nova Clínica

Siga esta lista em ordem. Cada etapa tem um checkpoint de verificação antes de avançar.

---

## PRÉ-REQUISITOS (feito uma única vez no servidor)

### A. Servidor Ubuntu com Docker e Node.js instalados
- [ ] Ubuntu 22.04+, mínimo 2 GB RAM, 20 GB disco
- [ ] Node.js 20+ instalado (necessário para build do painel React/Tailwind v4)
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  node -v  # deve exibir v20.x.x
  ```
- [ ] Docker e Docker Compose instalados
- [ ] Porta 80 e 443 abertas no firewall

### B. Código no servidor
```bash
cd /opt
git clone <URL_DO_REPO> agendazap
cd agendazap
```

### C. SSL — certificado Let's Encrypt
```bash
# Instala certbot
apt install -y certbot python3-certbot-nginx

# Gera certificado (substitua pelo domínio real)
certbot certonly --standalone \
  -d app.meuagendazap.com.br \
  --agree-tos --non-interactive --email seu@email.com
```

> O certificado fica em `/etc/letsencrypt/live/app.meuagendazap.com.br/`
> Isso é exatamente o caminho que o `nginx.conf` usa — não mova nem copie os arquivos.

**Checkpoint:** `ls /etc/letsencrypt/live/app.meuagendazap.com.br/` deve listar `fullchain.pem` e `privkey.pem`.

---

## ETAPA 1 — Configurar variáveis de ambiente

```bash
cd /opt/agendazap
cp .env.prod.example .env
nano .env
```

Preencha obrigatoriamente:

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | Senha forte (mínimo 16 chars) |
| `REDIS_PASSWORD` | Senha forte (mínimo 16 chars) |
| `EVOLUTION_API_KEY` | Chave forte (mínimo 32 chars) |
| `AI_PROVIDER` | `claude` ou `openai` |
| `CLAUDE_API_KEY` ou `OPENAI_API_KEY` | Chave da API escolhida |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 do Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 do Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://app.meuagendazap.com.br/admin/google/callback` |
| `SERVER_URL` | `https://app.meuagendazap.com.br` |
| `ADMIN_URL` | `https://app.meuagendazap.com.br/painel` |
| `JWT_SECRET` | String aleatória, mínimo 64 chars |
| `CLINIC_NAME` | Nome da clínica (ex: `Clínica Saúde Plena`) |
| `CLINIC_PHONE` | Número do WhatsApp com código do país (ex: `5561999990000`) |
| `ADMIN_EMAIL` | E-mail de login no painel |
| `ADMIN_SENHA` | Senha do painel (mínimo 8 chars, não use `admin123`) |

> Deixe `TEST_PHONE_WHITELIST=` vazio em produção.
> `EVOLUTION_API_URL` já está correto (`http://evolution-api:8080`) — não altere.

**Checkpoint:** `cat .env | grep -c "TROQUE"` deve retornar `0` (nenhum placeholder restante).

---

## ETAPA 2 — Primeiro deploy

```bash
cd /opt/agendazap
bash deploy.sh
```

O script executa na ordem:
1. `git pull` — atualiza o código
2. `npm run build` no `admin-panel/` — gera os arquivos estáticos do painel
3. `docker build` da imagem da aplicação
4. Sobe Postgres e Redis, aguarda ficarem `healthy`
5. Roda `prisma db push` — cria as tabelas
6. Sobe todos os serviços

**Checkpoint:**
```bash
docker compose -f docker-compose.prod.yml ps
```
Todos os containers devem estar `Up` (exceto `migrate` que já terminou).

```bash
curl -s https://app.meuagendazap.com.br/health | python3 -m json.tool
```
Esperado: `"status": "ok"` com `db: true` e `redis: true`.

---

## ETAPA 3 — Seed da clínica (primeira vez apenas)

```bash
docker compose -f docker-compose.prod.yml run --rm seed
```

O seed cria:
- A clínica com o `CLINIC_PHONE` configurado no `.env`
- 3 profissionais de exemplo (pode editar depois no painel)
- O usuário administrador com `ADMIN_EMAIL` + `ADMIN_SENHA`

**Checkpoint:**
```bash
docker compose -f docker-compose.prod.yml run --rm seed
```
Deve imprimir `🎉 Seed concluído com sucesso!` sem erros.

> O seed é idempotente — pode rodar novamente sem criar duplicatas.

---

## ETAPA 4 — Conectar o WhatsApp

### 4.1 Criar instância do WhatsApp
```bash
TOKEN=$(curl -s -X POST https://app.meuagendazap.com.br/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"SEU_ADMIN_EMAIL","senha":"SUA_SENHA"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

CLINICA_ID=$(curl -s -X POST https://app.meuagendazap.com.br/admin/instance/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['clinicaId'])")

echo "Clínica ID: $CLINICA_ID"
```

### 4.2 Obter QR Code
```bash
curl -s "https://app.meuagendazap.com.br/admin/instance/$CLINICA_ID/qrcode" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['qrcode'])"
```

Cole o valor `base64://...` em um visualizador de QR code online (ex: zxing.appspot.com) e escaneie com o WhatsApp da clínica.

**Checkpoint:**
```bash
curl -s "https://app.meuagendazap.com.br/admin/instance/$CLINICA_ID/status" \
  -H "Authorization: Bearer $TOKEN"
```
Esperado: `"state": "open"` — significa que o WhatsApp está conectado.

---

## ETAPA 5 — Acessar o painel administrativo

1. Abra `https://app.meuagendazap.com.br/painel` no navegador
2. Faça login com `ADMIN_EMAIL` e `ADMIN_SENHA`
3. Verifique o dashboard — contadores zerados é normal no início

### 5.1 Cadastrar os profissionais reais
- Menu **Profissionais** → substituir os 3 de exemplo pelos profissionais da clínica
- Configure nome, especialidade e duração da consulta de cada um

### 5.2 Configurar a clínica
- Menu **Configurações** → preencher:
  - Nome e endereço
  - Horário de funcionamento (dias da semana, início e fim)
  - Intervalo entre slots (padrão: 30 min)
  - Mensagem de boas-vindas personalizada (opcional)

---

## ETAPA 6 — Google Calendar (opcional)

Necessário apenas se a clínica quiser que os agendamentos usem a disponibilidade real de cada médico.
São dois passos obrigatórios — sem ambos, o Google Calendar não é utilizado.

### 6.1 Autorizar a conta Google da clínica
1. No painel, acesse **Configurações → Google Calendar**
2. Clique em **Conectar com Google** e autorize com a conta Google que contém as agendas dos médicos
3. Confirme que o status aparece como **Conectado**

### 6.2 Vincular cada profissional ao calendário dele
Após autorizar, cada médico precisa ser associado ao seu calendário específico.

```bash
TOKEN="..." # obtenha conforme Etapa 4.1
CLINICA_ID="..." # UUID da clínica

# 1. Lista os calendários disponíveis na conta Google conectada
curl -s "https://app.meuagendazap.com.br/admin/calendars/$CLINICA_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

A resposta lista os calendários com `id` e `summary` (nome). Anote o `id` do calendário de cada médico.

```bash
# 2. Vincula o calendário a cada profissional (repita para cada médico)
curl -s -X PUT \
  "https://app.meuagendazap.com.br/admin/profissionais/UUID_DO_PROFISSIONAL/calendar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"calendarId":"ID_DO_CALENDARIO"}'
```

> O `UUID_DO_PROFISSIONAL` aparece na resposta de `GET /admin/profissionais` ou no painel em **Profissionais**.

**Checkpoint:** após vincular, envie uma mensagem de teste ao bot escolhendo um profissional — os horários exibidos devem refletir a disponibilidade real do Google Calendar, não slots fixos.

> Se não configurar o Google Calendar, o bot ainda agenda normalmente usando horários gerados com base no horário de funcionamento configurado na Etapa 5.2.

---

## ETAPA 7 — Teste de ponta a ponta

Envie mensagens de teste para o número do WhatsApp da clínica:

- [ ] `"Oi"` → bot responde com menu de opções
- [ ] Escolha um profissional → bot exibe horários disponíveis
- [ ] Escolha um horário → bot pede nome do paciente
- [ ] Informe o nome → bot confirma o agendamento
- [ ] Verifique no painel (**Agendamentos**) se o agendamento aparece
- [ ] Verifique no painel (**Conversas**) se o histórico aparece

---

## ETAPA 8 — Pós-deploy

### Renovação automática do SSL
```bash
# Testa a renovação (sem aplicar)
certbot renew --dry-run

# Adiciona ao cron para renovar automaticamente
echo "0 3 * * * certbot renew --quiet && docker compose -f /opt/agendazap/docker-compose.prod.yml restart nginx" \
  | crontab -
```

### Monitorar logs
```bash
# Logs da aplicação em tempo real
docker compose -f docker-compose.prod.yml logs -f app

# Logs do nginx
docker compose -f docker-compose.prod.yml logs -f nginx

# Logs do Evolution API
docker compose -f docker-compose.prod.yml logs -f evolution-api
```

### Redeploy após atualização de código
```bash
cd /opt/agendazap
bash deploy.sh
```

---

## REFERÊNCIA RÁPIDA

| O que fazer | Comando |
|---|---|
| Ver status dos containers | `docker compose -f docker-compose.prod.yml ps` |
| Reiniciar aplicação | `docker compose -f docker-compose.prod.yml restart app` |
| Reiniciar nginx | `docker compose -f docker-compose.prod.yml restart nginx` |
| Acessar banco de dados | `docker compose -f docker-compose.prod.yml exec postgres psql -U agendazap -d agendazap` |
| Verificar health | `curl https://app.meuagendazap.com.br/health` |
| Painel | `https://app.meuagendazap.com.br/painel` |
| Evolution API | `http://IP_DO_SERVIDOR:8080` (acesso direto, sem nginx) |
