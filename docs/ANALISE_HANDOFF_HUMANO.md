# Análise — Handoff Humano (encaminhar conversa para um atendente)

> Documento de análise técnica e de produto. Objetivo: avaliar a complexidade, riscos e benefícios de incluir no AgendaZap a funcionalidade de **encaminhar uma conversa do bot para um atendente humano** da clínica, em formato profissional (não MVP-puro). Gerado em 2026-05-07.

---

## 1. Resumo executivo

Implementar handoff humano em uma plataforma multi-tenant com WhatsApp via Evolution API é um projeto **médio-grande** — não é uma feature pequena. A complexidade não está no código de "encaminhar" em si, mas em todos os requisitos colaterais que aparecem quando há um humano no loop: tempo real no painel, atribuição entre múltiplos atendentes, fora-do-horário, métricas, auditoria, retomada pelo bot e segurança de quem responde por quê.

**Estimativa**:

| Cenário | Esforço (dev-day) | Cobertura |
|---|---|---|
| MVP funcional (1 atendente, polling) | **7–10 dias** | Salva casos perdidos, mas não escala |
| Versão profissional (multi-atendente, tempo real, métricas, fora-do-horário) | **15–25 dias** | Pronta pra clínicas com 2+ recepcionistas |
| Versão enterprise (SLA, áudio/anexos, transbordo automático, integração CRM) | **30–45 dias** | Diferencial de mercado |

**Recomendação**: implementar em **3 fases incrementais**, validando com clínicas reais entre cada fase. Esta análise descreve as 3 fases.

---

## 2. Fluxo proposto (visão de produto)

### 2.1 Gatilhos de handoff

Três caminhos pelos quais uma conversa entra no estado "atendimento humano":

1. **Gatilho explícito do paciente** — paciente digita "falar com atendente", "quero falar com alguém", "atendente", "humano". Bot intercepta deterministicamente, igual aos fluxos atuais de cancelar/remarcar.
2. **Gatilho automático por contexto** — bot detecta sinais que justificam transbordo:
   - 3 mensagens consecutivas que ele não entendeu (já há contador `tentativas_sem_entendimento` no `contextoJson`).
   - Mensagem com tom de urgência clínica ("dor forte", "emergência", "sangrando") — palavras-chave em uma whitelist.
   - Pedido fora de escopo recorrente ("preciso de receita", "atestado", "resultado de exame").
3. **Gatilho proativo do atendente** — atendente abre o painel, vê uma conversa em andamento e clica em **"Assumir conversa"**. O bot é silenciado para aquele telefone.

### 2.2 Estados da conversa (extensão da máquina atual)

Novo valor no enum `EstadoBot`:

- `em_atendimento_humano` — bot está silenciado para esse telefone+clínica. Toda mensagem recebida vai para o painel e nada é respondido automaticamente.

Novo modelo `Atendimento` (ou usa-se `EstadoConversa.contextoJson`):

```prisma
model Atendimento {
  id           String           @id @default(uuid())
  clinicaId    String
  pacienteId   String
  telefone     String
  status       AtendimentoStatus @default(aberto)
  atendenteId  String?          // FK para UsuarioAdmin — null = ninguém pegou ainda
  motivo       String?          // "paciente solicitou" | "fallback automático" | "atendente assumiu"
  abertoEm     DateTime         @default(now())
  fechadoEm    DateTime?
  resumoFinal  String?          // resumo escrito pelo atendente ao devolver

  @@index([clinicaId, status])
  @@index([atendenteId, status])
}

enum AtendimentoStatus {
  aberto       // aguardando atendente pegar
  em_andamento // atendente atribuído, conversando
  fechado      // devolvido ao bot ou encerrado
}
```

### 2.3 Fluxo no webhook (mensagem do paciente)

```
mensagem chega →
  carrega clinica + paciente + estado_conversa
  ↓
  estado === 'em_atendimento_humano'?
  ├── sim → grava em conversas (direção=entrada), notifica painel, NÃO chama IA, NÃO envia resposta
  └── não → fluxo atual (deterministic intercepts → LLM → resposta)
```

### 2.4 Fluxo no painel (visão do atendente)

1. **Inbox** — lista de conversas com:
   - Não atribuídas (`status=aberto`, sem `atendenteId`)
   - Atribuídas a mim (`atendenteId === eu`)
   - Histórico fechadas (`status=fechado`)
   - Filtros: por paciente, por idade da última mensagem, por motivo de abertura
2. **Conversa aberta** — UI tipo chat:
   - Histórico das últimas 50 mensagens (já temos na tabela `conversas`)
   - Caixa de envio (com `direcao=saida`, `metadataJson.atendenteId=X`)
   - Botão **"Devolver para o bot"** — reseta `EstadoConversa.estado=inicio`, fecha o `Atendimento`, opcionalmente envia uma mensagem de transição (configurável).
   - Indicador de "paciente está digitando" (Evolution API expõe isso via webhook `chats.update`).
3. **Notificações** — aviso visual + sonoro para mensagens novas; eventualmente push notification (mobile) ou e-mail para clínicas pequenas.

### 2.5 Fluxo de devolução para o bot

Quando o atendente clica "Devolver":
- `Atendimento.status = 'fechado'`
- `EstadoConversa.estado = 'inicio'`, `contextoJson = {}` (limpa contexto antigo)
- Mensagem opcional ao paciente: "Continuamos por aqui se precisar! 😊 — *Recepção da Clínica X*"
- Próximas mensagens caem no fluxo automático normal.

---

## 3. Arquitetura — o que precisa mudar

### 3.1 Backend (`src/`)

| Componente | Mudança | Esforço |
|---|---|---|
| `prisma/schema.prisma` | Novo `EstadoBot.em_atendimento_humano`, novo model `Atendimento`, novo enum `AtendimentoStatus`, índices novos | 0.5d |
| `src/services/conversationService.js` | Novo helper `detectarIntencaoFalarComAtendente`, interceptação que abre `Atendimento` e silencia o bot | 1.5d |
| `src/webhooks/whatsapp.js` | Branch antes do `handleIncomingMessage` que verifica `em_atendimento_humano` e roteia para inbox | 0.5d |
| `src/routes/admin/atendimentos.js` (novo) | CRUD: listar, assumir, enviar mensagem, devolver, fechar | 2d |
| `src/services/realtimeService.js` (novo) | SSE ou WebSocket para empurrar mensagens novas ao painel | 2d |
| Auditoria | Toda mensagem de saída ganha `metadataJson.origem` = `bot \| atendente:<id>` | 0.5d |
| Métricas | Tempo médio de resposta, taxa de resolução pelo bot vs humano | 1d |
| **Subtotal backend** | | **8d** |

### 3.2 Painel admin (`admin-panel/`)

| Componente | Mudança | Esforço |
|---|---|---|
| `pages/Inbox.jsx` (novo) | Lista de conversas com filtros, badge de "não atribuído" | 2d |
| `pages/ConversaLive.jsx` (novo) | UI de chat ao vivo, envio de mensagens, indicadores | 3d |
| Conexão tempo real (EventSource ou socket.io) | Subscrição por `clinicaId`; reconexão automática | 1.5d |
| Som/notificação navegador | Web Audio + Notification API + favicon dinâmico | 0.5d |
| Estado global | Zustand ou Context para conversas abertas, contadores | 0.5d |
| **Subtotal painel** | | **7.5d** |

### 3.3 Operação / DevOps

| Componente | Mudança | Esforço |
|---|---|---|
| Configuração Evolution API | Habilitar webhook `chats.update` (typing) e `messages.update` | 0.5d |
| Tolerância a falhas WS/SSE | Reconnect, fallback polling, heartbeat | 0.5d |
| Documentação | Manual da clínica explicando o fluxo, FAQ | 1d |
| Monitoring | Alerta de "conversas abertas há mais de N min sem resposta" | 0.5d |
| **Subtotal ops** | | **2.5d** |

**Total versão profissional**: ~18 dias-dev (≈3.5 sprints de 1 semana). Margem de 30% de buffer → **~25 dias**.

---

## 4. Riscos e contras

### 4.1 Risco técnico

1. **Race conditions paciente ↔ atendente** (alto). Cenário: atendente clicou "Assumir" mas o webhook de uma nova mensagem ainda está sendo processado pela IA — o paciente pode receber resposta do bot logo depois do "Olá, sou Maria da recepção". *Mitigação*: leitura do estado dentro de uma transação Prisma + usar `messageTimestamp` como tie-breaker.

2. **Tempo real em multi-tenant** (médio). SSE/WS funcionam bem em uma instância única, mas se o servidor escalar horizontalmente é preciso coordenar via Redis pub/sub. *Mitigação*: BullMQ e Redis já estão no stack — adicionar canal pub/sub é incremental.

3. **Janela de 24h do WhatsApp** (médio se migrar para WhatsApp Business API; baixo no Evolution/Baileys atual). Hoje a Evolution usa Baileys (cliente não oficial), sem regra estrita. Em uma migração futura para WhatsApp Cloud API, mensagens fora da janela de 24h precisam de templates aprovados. Atendentes acostumados a responder a qualquer hora podem ficar bloqueados.

4. **Persistência de estado em deploy** (baixo). Atualmente, se o servidor reinicia no meio de um atendimento humano, o estado fica preservado no banco — o painel só precisa recarregar. Mas a conexão SSE/WS quebra. *Mitigação*: heartbeat e reconnect automático no cliente.

5. **Mensagens de mídia** (médio). O bot atualmente só lê texto. Para handoff humano, áudios de paciente seriam comuns ("ouve aí, gravei o que tô sentindo") — requer transcrição (Whisper API) ou exibição inline. *Decisão*: na v1, exibe ícone "🎙️ Áudio recebido" e o atendente reproduz no próprio WhatsApp da clínica.

### 4.2 Risco de produto

6. **Expectativa do paciente** (alto). Pacientes acostumados a respostas instantâneas do bot vão estranhar quando atendentes demorarem a responder. *Mitigação*: ao acionar handoff, bot deve enviar confirmação clara: "Vou te transferir para nossa recepção. Em horário comercial, costumam responder em alguns minutos. Fora do horário, retornaremos pela manhã."

7. **Fora do horário comercial** (alto). Sem cobertura, o paciente fica em "atendimento humano" sem ninguém do outro lado. *Mitigação*: configuração `horarioAtendimento` por clínica + auto-resposta "Estamos fora do horário (08h–18h, seg-sex). Sua mensagem foi registrada e você terá retorno até ..." + auto-fechamento após X horas para liberar o bot.

8. **Sobrecarga de uma recepcionista** (médio). Clínicas pequenas têm 1 pessoa na recepção que já lida com pacientes presenciais. Adicionar inbox de chat ao trabalho dela pode piorar a experiência. *Mitigação*: o bot continua resolvendo 80%+ dos casos (agendar/cancelar/remarcar já são determinísticos); o inbox só recebe os 20% complexos.

9. **Confusão de identidade** (médio). Quando o atendente assume, a mensagem chega como vinda do mesmo número (telefone da clínica). Paciente não sabe se está falando com bot ou pessoa. *Mitigação*: convenção de assinatura: bot nunca assina; atendente sempre encerra com "— *Maria, recepção*".

### 4.3 Risco de conformidade (LGPD)

10. **Quem viu a conversa?** (alto). Toda conversa entre paciente e clínica é dado de saúde sensível (LGPD Art. 5º II). Hoje o painel já lê `tabela conversas` — o handoff não muda isso, mas amplifica o uso. *Mitigação*: log de auditoria de quem acessou cada `Atendimento` (tabela `AtendimentoAuditoria`); criptografia em repouso (já temos via TLS de banco, mas talvez column-level encryption das mensagens).

11. **Direito ao esquecimento**. Se o paciente pedir exclusão, o backend hoje cascateia delete em `Conversa`. O `Atendimento` precisa ser incluído nesse cascade. *Esforço*: 0.5d de cuidado no schema.

12. **Retenção de mensagens**. Quanto tempo manter conversas? A política deve ser explícita por clínica; default 12 meses, com purge automatizado.

### 4.4 Risco de negócio

13. **Quebra de produto** (baixo). O fluxo automático atual é o produto principal. Handoff é bem isolado — se a feature ficar instável, dá pra desligar a flag por clínica e voltar ao bot puro.

14. **Suporte ao cliente vira parte do produto** (alto). Hoje, se uma clínica ligar reclamando "o bot não respondeu", a resposta é "ele só faz X, Y, Z". Com handoff humano: "minha recepção não consegue ver as mensagens" passa a ser bug crítico. SLA implícito sobe.

15. **Viola posicionamento de "automação total"** (baixo-médio). Se o pitch comercial é "automatize 100%", a feature contradiz. *Mitigação*: posicionar como "automação inteligente com escalada humana" — diferencial em vez de admissão de fraqueza.

---

## 5. Vantagens

1. **Salva casos que hoje se perdem**. Pacientes que mandam pergunta fora de escopo recebem hoje "não entendi" 3 vezes e desistem. Com handoff, viram pacientes atendidos.

2. **Aumenta confiança da clínica para confiar mais no bot**. Saber que sempre podem assumir reduz a resistência. Empiricamente, soluções concorrentes (Botconversa, Take Blip) usam isso como gancho de venda.

3. **Captura de dados pra evolução do produto**. Cada handoff é sinal: especialidade nova, dúvida frequente, fluxo faltando. Vira backlog de melhoria do bot.

4. **Permite vender SKU "Premium"**. Plano básico = bot puro; plano premium = bot + inbox de atendimento. Diferenciação clara de preço.

5. **Compliance e auditoria**. Hoje toda conversa é processada pela IA; com handoff, sensitivos podem ser triados para humanos antes mesmo de virar prompt para o LLM. Reduz superfície de exposição de dados.

6. **Permite bot mais ousado**. Hoje, o medo de o bot errar limita o que ele faz. Com escala humana garantida, dá pra dar mais autonomia ao bot (ex: confirmar resultados de exame, lidar com pedidos de receita) sabendo que casos duvidosos escalam.

---

## 6. Cronograma faseado proposto

### Fase 1 — MVP (7–10 dias)

**Escopo**: 1 atendente por clínica, polling a cada 10s, sem áudio, gatilho só explícito ("falar com atendente").

- Schema: `EstadoBot.em_atendimento_humano` + tabela `Atendimento` mínima
- Backend: detecção do gatilho, silenciar bot, rotas básicas (listar, assumir, enviar, devolver)
- Painel: aba "Atendimentos" com tabela de conversas e UI de chat baseada em refresh
- Sem WebSocket, sem áudio, sem fora-do-horário automático

**Entrega**: clínica consegue assumir uma conversa, responder e devolver. Suficiente para piloto com 1–2 clínicas.

### Fase 2 — Profissional (mais 8–15 dias)

- Tempo real via SSE (mais simples que WS) com fallback polling
- Multi-atendente: atribuição manual + lock
- Configuração de horário comercial + auto-resposta fora do horário
- Auto-fechamento após X horas sem resposta
- Auditoria mínima (quem acessou, quem respondeu)
- Métricas básicas: taxa de transbordo, tempo médio de resposta humana
- Notificação no navegador (sem mobile)

**Entrega**: pronta pra clínicas com 2–4 recepcionistas usando regularmente.

### Fase 3 — Enterprise (mais 10–20 dias, opcional)

- SLA por clínica + alertas de violação
- Áudio: transcrição automática (Whisper) e player inline
- Anexos (foto, documento) com preview
- Templates de respostas rápidas
- Transbordo automático via palavras-chave (urgência, emergência)
- Integração com CRM externo (HubSpot, Pipedrive)
- Push notification mobile (PWA ou app nativo)

**Entrega**: diferencial competitivo claro vs Botconversa/Take Blip para o segmento de saúde.

---

## 7. Pontos de decisão antes de começar

1. **Tempo real: SSE ou WebSocket?** Recomendação: **SSE** — mais simples, funciona em CDN/proxies, suficiente para fluxo unidirecional servidor→cliente; envios do cliente continuam por HTTP normal.

2. **1 atendente por clínica ou múltiplos desde o início?** Recomendação: **arquitetar para múltiplos** desde a Fase 1 (basta o campo `atendenteId`); mas a UI da Fase 1 simplifica assumindo 1 ativo.

3. **Áudio na v1?** Recomendação: **não** — exibir como mensagem "[áudio recebido — abra no WhatsApp]" e tratar transcrição como Fase 3. Whisper API custa dinheiro e adiciona latência.

4. **Inbox no admin atual ou produto separado?** Recomendação: **mesmo painel admin**, nova rota `/atendimentos`. Reaproveita auth, layout, deploy.

5. **Aceitar mensagens fora de horário ou bloquear?** Recomendação: **aceitar e responder com expectativa clara** ("respondemos amanhã 8h"). Bloquear gera frustração e reclamação.

6. **O que acontece com lembretes durante atendimento humano?** Recomendação: **suspender** lembretes para esse paciente enquanto `em_atendimento_humano`. O atendente já vai abordar diretamente o que precisar; lembrete em paralelo confunde.

---

## 8. Conclusão

**Vale a pena?** Sim, mas não como próxima feature imediata. O produto atual ainda está estabilizando os fluxos automáticos (cancelamento, remarcação) — mexer agora aumenta superfície de erro durante a fase em que pacientes estão sendo treinados a confiar no bot.

**Quando atacar**: depois de 2–4 semanas de operação estável dos fluxos automáticos atuais com clínicas reais; quando aparecer a primeira reclamação concreta de "preciso assumir essa conversa". Esse sinal é melhor do que decidir a frio.

**Como atacar**: começar pela **Fase 1 (MVP, 7–10 dias)** com uma clínica piloto. A Fase 1 é descartável — pode jogar fora e refazer na Fase 2 — mas valida o fluxo de produto antes do investimento maior.

**Riscos críticos a vigiar desde o dia 1**: race conditions de estado (item 4.1.1), expectativa de paciente (4.2.6) e LGPD/auditoria (4.3.10). Os outros são gerenciáveis ou específicos de fases posteriores.
