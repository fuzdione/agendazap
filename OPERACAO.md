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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | console.cloud.google.com |
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

```powershell
npm run db:seed
```

**O que faz:** Insere 1 clínica e 3 profissionais de teste no banco.
**Resultado esperado:**

```
✅ Seed concluído
   Clínica: Clínica Saúde Plena (ID: xxxxxxxx-...)
   Profissionais: 3 inseridos
```

---

### 1.6 Iniciar o servidor

```powershell
npm run dev
```

**O que faz:** Sobe o servidor Fastify na porta 3000 com hot-reload.
**Resultado esperado:**

```
🚀 AgendaZap rodando em http://0.0.0.0:3000
```

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

**O que faz:** Executa os 55 testes com Vitest (sem subir servidor, sem acessar banco ou APIs externas — tudo mockado).
**Resultado esperado:**
```
 Test Files  4 passed (4)
      Tests  55 passed (55)
```

**Modo watch** (re-executa ao salvar um arquivo):
```powershell
npm run test:watch
```

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

> Para os comandos abaixo, você precisa do ID da clínica. Obtenha-o com:
> ```powershell
> curl http://localhost:3000/health  # confirma que o servidor está rodando
> ```
> O ID está no banco — acesse via Prisma Studio (seção 4.1).

### 3.1 Criar instância WhatsApp para uma clínica

```powershell
curl -X POST http://localhost:3000/admin/instance/create `
  -H "Content-Type: application/json" `
  -d '{"clinicaId": "ID_DA_CLINICA"}'
```

**O que faz:** Registra a clínica na Evolution API usando o telefone dela como nome da instância.
**Resultado esperado:** JSON com dados da instância criada e QR code base64.

---

### 3.2 Gerar QR code para conectar o WhatsApp

```powershell
curl http://localhost:3000/admin/instance/ID_DA_CLINICA/qrcode
```

**O que faz:** Retorna o QR code para escanear com o celular da clínica.
**Como usar o QR:** O campo `code` na resposta é o conteúdo do QR. Cole em qualquer gerador online (ex: `qr-code-generator.com`) para visualizar a imagem.

**Alternativa visual:** Acesse o Evolution Manager em `http://localhost:8080/manager` (credencial: a `EVOLUTION_API_KEY` do `.env`).

---

### 3.3 Verificar status da conexão WhatsApp

```powershell
curl http://localhost:3000/admin/instance/ID_DA_CLINICA/status
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
docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "SELECT direcao, mensagem, created_at FROM public.conversas WHERE telefone = 'NUMERO' ORDER BY created_at;"
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
docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "SELECT telefone, estado, contexto_json, updated_at FROM public.estado_conversa ORDER BY updated_at DESC LIMIT 10;"
```

Mostra em que etapa do fluxo cada paciente está e os dados já coletados (especialidade, horário, nome).

---

### 4.4 Resetar estado de uma conversa (forçar reinício)

```powershell
docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE public.estado_conversa SET estado = 'inicio', contexto_json = '{}' WHERE telefone = 'NUMERO';"
```

**Quando usar:** Quando uma conversa travar em estado inconsistente durante testes.

---

### 4.5 Ver agendamentos criados pelo bot

```powershell
docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "SELECT a.id, p.nome AS paciente, pr.nome AS profissional, a.data_hora, a.status FROM public.agendamentos a JOIN public.pacientes p ON p.id = a.paciente_id JOIN public.profissionais pr ON pr.id = a.profissional_id ORDER BY a.data_hora;"
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
docker exec -it agendazap-postgres psql -U agendazap -d agendazap
```

**Comandos úteis dentro do psql:**

```sql
\dt public.*          -- lista tabelas do schema público
\dt evolution.*       -- lista tabelas da Evolution API
SELECT * FROM public.clinicas;
\q                    -- sair
```

---

## 6. TROUBLESHOOTING

### O bot não responde às mensagens

**Passo 1 — Verifique se o servidor está rodando:**
```powershell
curl http://localhost:3000/health
```
Se falhar: `npm run dev`

**Passo 2 — Verifique se o WhatsApp está conectado:**
```powershell
curl http://localhost:3000/admin/instance/ID_DA_CLINICA/status
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
curl http://localhost:3000/admin/instance/ID_DA_CLINICA/qrcode
```

**Se ainda não funcionar — delete e recrie a instância:**
```powershell
curl -X DELETE -H "apikey: agendazap-dev-key" http://localhost:8080/instance/delete/NOME_DA_INSTANCIA

curl -X POST http://localhost:3000/admin/instance/create `
  -H "Content-Type: application/json" `
  -d '{"clinicaId": "ID_DA_CLINICA"}'
```

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

## Referência Rápida

| Ação | Comando |
|---|---|
| Rodar testes | `npm test` |
| Subir tudo | `docker compose start && npm run dev` |
| Parar bot (celular normal) | `taskkill /IM node.exe /F` |
| Parar tudo | `taskkill /IM node.exe /F && docker compose stop` |
| Health check | `curl http://localhost:3000/health` |
| Status WhatsApp | `curl http://localhost:3000/admin/instance/ID/status` |
| Painel Evolution | http://localhost:8080/manager |
| Prisma Studio | `npx prisma studio` → http://localhost:5555 |
| Logs do bot | Terminal onde `npm run dev` está rodando |
| Logs Evolution | `docker logs agendazap-evolution --tail 50` |
| Testar Claude API | `node -e "import('./src/services/claudeService.js').then(async({processMessage})=>{const r=await processMessage('oi','Assistente.',[]);console.log(r.mensagemParaPaciente);})"`  |
| Ver conversas (banco) | `npx prisma studio` → tabela `Conversa` |
| Ver estado das conversas | `docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "SELECT telefone, estado, updated_at FROM public.estado_conversa ORDER BY updated_at DESC LIMIT 10;"` |
| Resetar conversa travada | `docker exec -it agendazap-postgres psql -U agendazap -d agendazap -c "UPDATE public.estado_conversa SET estado='inicio', contexto_json='{}' WHERE telefone='NUMERO';"` |
