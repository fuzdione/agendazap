# Manual de Deploy — AgendaZap (Produção)

> Última atualização: Etapa 6 (Painel Administrativo)

---

## Índice

1. [Pré-requisitos do servidor](#1-pré-requisitos-do-servidor)
2. [Variáveis de ambiente](#2-variáveis-de-ambiente)
3. [DNS — subdomínios necessários](#3-dns--subdomínios-necessários)
4. [Build do painel admin (frontend)](#4-build-do-painel-admin-frontend)
5. [Primeiro deploy](#5-primeiro-deploy)
6. [Checkpoint: banco de dados populado](#6-checkpoint-banco-de-dados-populado)
7. [Checkpoint: serviços rodando](#7-checkpoint-serviços-rodando)
8. [Configurar HTTPS com certbot](#8-configurar-https-com-certbot)
9. [Conectar WhatsApp (QR Code)](#9-conectar-whatsapp-qr-code)
10. [Autorizar Google Calendar](#10-autorizar-google-calendar)
11. [Atualizar versão (redeploy)](#11-atualizar-versão-redeploy)
12. [Comandos úteis de manutenção](#12-comandos-úteis-de-manutenção)
13. [Solução de problemas](#13-solução-de-problemas)

---

## 1. Pré-requisitos do servidor

```bash
# Ubuntu 22.04+ recomendado
# Docker Engine 24+
curl -fsSL https://get.docker.com | sh

# Docker Compose v2 (já incluído no Docker Engine moderno)
docker compose version   # deve ser >= 2.20

# Node.js 20+ (apenas para o build do painel — não é necessário em prod)
# Instale via nvm se não tiver:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 20
```

---

## 2. Variáveis de ambiente

Crie o arquivo `.env` na raiz do projeto. **Nunca commite este arquivo.**

```bash
cp .env.example .env
nano .env
```

Preencha todos os campos abaixo:

```env
# ── Banco de dados ──────────────────────────────────────────────────────────
POSTGRES_USER=agendazap
POSTGRES_PASSWORD=SENHA_FORTE_AQUI          # mínimo 20 caracteres, sem @

# ── Redis ───────────────────────────────────────────────────────────────────
REDIS_PASSWORD=OUTRA_SENHA_FORTE_AQUI

# ── Backend ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://agendazap:SENHA_FORTE_AQUI@postgres:5432/agendazap
REDIS_URL=redis://:OUTRA_SENHA_FORTE_AQUI@redis:6379

# ── Evolution API (WhatsApp) ────────────────────────────────────────────────
EVOLUTION_API_URL=https://evolution.SEU_DOMINIO
EVOLUTION_API_KEY=CHAVE_ALEATORIA_LONGA     # ex: openssl rand -hex 32

# ── IA ──────────────────────────────────────────────────────────────────────
AI_PROVIDER=openai                          # ou: claude
OPENAI_API_KEY=sk-...
CLAUDE_API_KEY=sk-ant-...

# ── Google Calendar ──────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.SEU_DOMINIO/admin/google/callback

# ── Painel admin ─────────────────────────────────────────────────────────────
ADMIN_URL=https://admin.SEU_DOMINIO         # URL do painel (sem / no final)
JWT_SECRET=SEGREDO_JWT_MUITO_LONGO          # ex: openssl rand -hex 32

# ── Seed — CRÍTICO para o primeiro deploy ─────────────────────────────────────
# CLINIC_PHONE: número WhatsApp da clínica, formato DDI+DDD+número, sem + ou espaços
# Deve ser EXATAMENTE o número que vai receber mensagens dos pacientes.
# Se errar aqui, o painel fica vinculado à clínica errada (sem agendamentos, WPP desconectado).
CLINIC_PHONE=5511999990000
CLINIC_NAME="Nome da Clínica"
ADMIN_EMAIL=admin@suaclinica.com.br
# Senha do painel — o seed recusa "admin123" em NODE_ENV=production
ADMIN_SENHA=SenhaForteAqui123!

# ── Outros ───────────────────────────────────────────────────────────────────
NODE_ENV=production
TEST_PHONE_WHITELIST=                       # deixe vazio em prod
```

> **Senhas com caracteres especiais** (@, #, !, etc.) **quebram** a connection string
> na variável `DATABASE_URL`. Use apenas letras, números e hífens nas senhas de
> banco e Redis — ou faça URL-encode manualmente.

> **CLINIC_PHONE errado = painel vazio em produção.** O sistema cria a clínica
> automaticamente quando o primeiro paciente manda mensagem. Se o CLINIC_PHONE do
> seed não bater com esse número, o seed cria uma segunda clínica e o admin fica
> vinculado à errada. Confirme o número antes de rodar o seed.

---

## 3. DNS — subdomínios necessários

Crie os seguintes registros A no painel do seu DNS, todos apontando para o IP do servidor:

| Subdomínio | Finalidade |
|---|---|
| `api.SEU_DOMINIO` | Backend Fastify (webhook WhatsApp + rotas admin) |
| `admin.SEU_DOMINIO` | Painel administrativo (React, arquivos estáticos) |
| `evolution.SEU_DOMINIO` | Evolution API (WhatsApp Business) |

Substitua `SEU_DOMINIO` em `nginx/nginx.conf` pelos valores reais antes de subir.

```bash
# Substitua em lote (exemplo com sed):
sed -i 's/SEU_DOMINIO/agendazap.com.br/g' nginx/nginx.conf
```

---

## 4. Build do painel admin (frontend)

> Este passo é feito **no servidor** (ou na sua máquina antes de copiar os arquivos).
> O nginx serve os arquivos estáticos gerados — não há Node.js servindo o frontend em prod.

```bash
cd admin-panel
npm install
npm run build
cd ..
```

Isso gera a pasta `admin-panel/dist/`. O `docker-compose.prod.yml` já monta essa
pasta dentro do nginx automaticamente.

**Checkpoint:** Confirme que a pasta existe:

```bash
ls admin-panel/dist/
# Deve listar: index.html  assets/
```

---

## 5. Primeiro deploy

```bash
# 1. Suba postgres e redis primeiro (outros serviços dependem deles estarem healthy)
docker compose -f docker-compose.prod.yml up -d postgres redis
```

**Aguarde o healthcheck passar** (≈15s):

```bash
docker compose -f docker-compose.prod.yml ps
# postgres e redis devem aparecer como "(healthy)"
```

```bash
# 2. Rode o migrate (cria/atualiza as tabelas)
docker compose -f docker-compose.prod.yml up migrate --exit-code-from migrate
```

**Checkpoint — migrate:** O comando deve terminar com saída parecida com:

```
Your database is now in sync with your Prisma schema.
```

Se aparecer erro de senha/conexão, revise `DATABASE_URL` no `.env`.

```bash
# 3. Rode o seed (cria o usuário admin e dados iniciais)
#    É seguro rodar mais de uma vez — usa upsert, não duplica dados.
docker compose -f docker-compose.prod.yml up seed --exit-code-from seed
```

**Checkpoint — seed:** Saída esperada:

```
✅ Clínica: Clínica Saúde Plena
✅ Profissional criado: Dr. João Silva — Clínico Geral
✅ Profissional criado: Dra. Maria Santos — Dermatologia
✅ Profissional criado: Dra. Ana Costa — Nutrição
✅ Usuário admin: admin@clinicasaudeplena.com.br
🎉 Seed concluído com sucesso!
```

```bash
# 4. Suba o restante dos serviços
docker compose -f docker-compose.prod.yml up -d
```

---

## 6. Checkpoint: banco de dados populado

Confirme que as tabelas e o usuário admin existem:

```bash
docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "\dt"
```

Deve listar: `agendamentos`, `clinicas`, `conversas`, `estado_conversa`,
`pacientes`, `profissionais`, `usuarios_admin`.

```bash
docker exec -it agendazap-postgres psql -U agendazap -d agendazap \
  -c "SELECT email, created_at FROM usuarios_admin;"
```

Deve aparecer `admin@clinicasaudeplena.com.br`.

---

## 7. Checkpoint: serviços rodando

```bash
docker compose -f docker-compose.prod.yml ps
```

Saída esperada (todos com `Up` ou `healthy`):

```
NAME                   STATUS
agendazap-app          Up
agendazap-evolution    Up
agendazap-nginx        Up
agendazap-postgres     Up (healthy)
agendazap-redis        Up (healthy)
```

Os containers `agendazap-migrate` e `agendazap-seed` aparecerão como `Exited (0)` — isso é correto.

Teste o backend:

```bash
curl https://api.SEU_DOMINIO/health
# {"status":"ok","services":{"db":true,"redis":true}}
```

Teste o painel (deve retornar o HTML do React):

```bash
curl -I https://admin.SEU_DOMINIO
# HTTP/2 200
```

---

## 8. Configurar HTTPS com certbot

```bash
# Instale o certbot
apt install -y certbot

# Gere certificados para os 3 subdomínios
# O nginx precisa estar rodando (modo HTTP primeiro)
certbot certonly --webroot -w /var/www/html \
  -d api.SEU_DOMINIO \
  -d admin.SEU_DOMINIO \
  -d evolution.SEU_DOMINIO
```

Os certificados ficam em `/etc/letsencrypt/live/`. Monte-os no nginx editando
`docker-compose.prod.yml`:

```yaml
  nginx:
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/nginx/certs:ro   # <- aponta para o certbot
      - ./admin-panel/dist:/usr/share/nginx/html/admin:ro
```

Depois descomente os blocos `server { listen 443 ssl; ... }` em `nginx/nginx.conf`
e reinicie o nginx:

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

**Renovação automática** (adicione ao cron do servidor):

```bash
crontab -e
# Adicione:
0 3 * * * certbot renew --quiet && docker compose -f /caminho/agendazap/docker-compose.prod.yml restart nginx
```

---

## 9. Conectar WhatsApp (QR Code)

1. Acesse `https://admin.SEU_DOMINIO`
2. Login: use o `ADMIN_EMAIL` e `ADMIN_SENHA` definidos no `.env`
3. Vá em **Configurações**
4. Na seção **Conexão WhatsApp**, clique em **Ver QR Code**
5. Escaneie com o celular do número da clínica
6. Recarregue — o status deve aparecer como **Conectado**

> Após conectar, configure o webhook da Evolution API para apontar para o backend:
>
> ```bash
> curl -X POST https://evolution.SEU_DOMINIO/webhook/set/NOME_DA_INSTANCIA \
>   -H "apikey: SUA_EVOLUTION_API_KEY" \
>   -H "Content-Type: application/json" \
>   -d '{"url":"https://api.SEU_DOMINIO/webhook/whatsapp","enabled":true}'
> ```

---

## 10. Autorizar Google Calendar

1. No painel, vá em **Configurações**
2. Na seção **Conexão Google Calendar**, clique em **Autorizar acesso**
3. Faça login com a conta Google da clínica
4. Volte ao painel — status deve mudar para **Autorizado**
5. Acesse **Profissionais** e vincule o calendário correto a cada profissional

---

## 11. Atualizar versão (redeploy)

```bash
# 1. Puxe o código novo
git pull

# 2. Se houve mudanças no admin-panel, rebuilde o frontend
cd admin-panel && npm install && npm run build && cd ..

# 3. Rebuilde a imagem do backend e reinicie
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app

# 4. Se houve mudanças no schema.prisma, rode o migrate novamente
docker compose -f docker-compose.prod.yml up migrate --exit-code-from migrate

# 5. Reinicie o nginx se houve mudanças no nginx.conf
docker compose -f docker-compose.prod.yml restart nginx
```

> **Nunca rode o seed novamente em produção** após a primeira vez se você já
> alterou a senha do admin pelo painel — o seed usa `upsert` e não sobrescreve
> senhas, mas é uma boa prática manter o seed apenas para o primeiro deploy.

---

## 12. Comandos úteis de manutenção

```bash
# Ver logs em tempo real
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f nginx

# Entrar no container do app
docker compose -f docker-compose.prod.yml exec app sh

# Verificar filas BullMQ (via Redis CLI)
docker exec -it agendazap-redis redis-cli -a REDIS_PASSWORD
> KEYS bull:reminders:*

# Backup do banco de dados
docker exec agendazap-postgres pg_dump -U agendazap agendazap > backup_$(date +%Y%m%d).sql

# Restaurar backup
docker exec -i agendazap-postgres psql -U agendazap agendazap < backup_YYYYMMDD.sql

# Resetar senha do admin (se esqueceu)
docker compose -f docker-compose.prod.yml exec app node -e "
import('bcrypt').then(b => b.hash('nova_senha', 10)).then(h => {
  import('./src/config/database.js').then(({prisma}) =>
    prisma.usuarioAdmin.update({
      where: { email: 'admin@clinicasaudeplena.com.br' },
      data: { senhaHash: h }
    }).then(() => { console.log('Senha atualizada'); process.exit(0); })
  )
})
"
```

---

## 13. Armadilhas conhecidas (aprendidas em dev)

Estes são problemas reais que aconteceram durante o desenvolvimento e estão corrigidos no código. Servem de referência caso apareçam variações em produção.

### Painel mostra "Desconectado" mesmo com WhatsApp funcionando

**Causa:** O seed criou uma clínica com o telefone errado (ou padrão). O painel autentica o admin via JWT com o `clinicaId` daquela clínica, e a busca de status usa o telefone dela — que não bate com o número real da Evolution API.

**Como detectar:**
```bash
docker exec agendazap-postgres psql -U agendazap -d agendazap \
  -c "SELECT ua.email, c.telefone_wpp FROM usuarios_admin ua JOIN clinicas c ON c.id = ua.clinica_id;"
```
Se o `telefone_wpp` não for o número real da clínica, o seed rodou com `CLINIC_PHONE` errado.

**Correção:** Ajuste o `CLINIC_PHONE` no `.env` e rode o seed novamente. Se o banco já tiver duas clínicas, mova o admin para a correta:
```bash
docker exec agendazap-postgres psql -U agendazap -d agendazap \
  -c "UPDATE usuarios_admin SET clinica_id = 'ID_CLINICA_CORRETA' WHERE email = 'ADMIN_EMAIL';"
```

### Profissionais duplicados no bot

**Causa:** O seed criou profissionais na clínica errada e depois foram movidos para a clínica correta, que já tinha os mesmos profissionais.

**Como detectar:**
```bash
docker exec agendazap-postgres psql -U agendazap -d agendazap \
  -c "SELECT nome, COUNT(*) FROM profissionais GROUP BY nome HAVING COUNT(*) > 1;"
```

**Correção:** Remova os duplicados sem agendamentos e sem `calendar_id`:
```bash
docker exec agendazap-postgres psql -U agendazap -d agendazap \
  -c "DELETE FROM profissionais WHERE calendar_id IS NULL AND id NOT IN (SELECT profissional_id FROM agendamentos);"
```

**Prevenção (já aplicada):** O seed só cria profissionais de exemplo se a clínica não tiver nenhum. `CLINIC_PHONE` correto desde o início evita o problema inteiro.

### seed falha com "CLINIC_PHONE não definido"

O `.env` não tem a variável `CLINIC_PHONE`. Adicione antes de rodar:
```bash
echo "CLINIC_PHONE=5511999990000" >> .env
```

### seed falha com "ADMIN_SENHA está com o valor padrão"

Em `NODE_ENV=production`, o seed recusa a senha `admin123` por segurança. Defina uma senha forte no `.env`:
```bash
# Gerar senha aleatória segura:
openssl rand -base64 16
# Adicionar ao .env:
echo "ADMIN_SENHA=SenhaGerada" >> .env
```

---

## 14. Solução de problemas

### migrate falha com "drift detected"

O banco tem tabelas mas sem histórico de migration. Isso ocorre quando o projeto
usou `db push` em vez de `migrate dev`. O `docker-compose.prod.yml` já está
configurado para usar `prisma db push --accept-data-loss`, que resolve isso.

Se ainda falhar, force a sincronização manualmente:

```bash
docker compose -f docker-compose.prod.yml exec migrate \
  npx prisma db push --accept-data-loss
```

### seed falha com "connection refused"

O postgres ainda não está healthy. Aguarde e tente novamente:

```bash
docker compose -f docker-compose.prod.yml ps postgres
# Aguarde aparecer "(healthy)" antes de rodar o seed
docker compose -f docker-compose.prod.yml up seed --exit-code-from seed
```

### Painel retorna 404 em rotas como /agendamentos

O nginx não está configurado com `try_files $uri /index.html`. Verifique se o
bloco correto do `nginx.conf` está sendo usado e reinicie:

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -t   # testa a config
docker compose -f docker-compose.prod.yml restart nginx
```

### Login retorna "Credenciais inválidas" logo após o seed

Confirme que o seed rodou com sucesso checando o banco (passo 6). Se o container
`seed` terminou com `Exited (1)`, rode novamente:

```bash
docker compose -f docker-compose.prod.yml up seed --exit-code-from seed
```

### CORS bloqueando o painel em produção

Confirme que `ADMIN_URL` no `.env` está igual ao domínio exato do painel
(sem `/` no final, com o protocolo correto):

```env
ADMIN_URL=https://admin.SEU_DOMINIO   # correto
ADMIN_URL=https://admin.SEU_DOMINIO/  # ERRADO — barra extra
```

Reinicie o app após corrigir:

```bash
docker compose -f docker-compose.prod.yml restart app
```

### app não sobe: "awaiting migrate"

O container `app` depende do `migrate` ter concluído com sucesso
(`service_completed_successfully`). Se o migrate falhou com exit code != 0,
o app não inicia. Resolva o migrate primeiro (ver acima) e depois:

```bash
docker compose -f docker-compose.prod.yml up -d app
```
