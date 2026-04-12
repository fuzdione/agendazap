# Manual de Operação — Painel Administrativo AgendaZap

Este manual é destinado ao **administrador da clínica**. Ele cobre todas as funcionalidades do painel, desde o primeiro acesso até as operações do dia a dia.

---

## Índice

1. [Primeiro acesso — configuração inicial](#1-primeiro-acesso--configuração-inicial)
2. [Dashboard](#2-dashboard)
3. [Agendamentos](#3-agendamentos)
4. [Profissionais](#4-profissionais)
5. [Configurações](#5-configurações)
6. [Conversas](#6-conversas)
7. [Status dos agendamentos — referência](#7-status-dos-agendamentos--referência)
8. [Como o bot usa as suas configurações](#8-como-o-bot-usa-as-suas-configurações)
9. [Lembretes automáticos](#9-lembretes-automáticos)
10. [Perguntas frequentes](#10-perguntas-frequentes)

---

## 1. Primeiro acesso — configuração inicial

Ao receber suas credenciais do proprietário do sistema, siga esta sequência **uma única vez** para deixar o bot operacional.

### 1.1 Fazer login

Acesse o endereço do painel fornecido pelo proprietário e faça login com o e-mail e senha recebidos.

> Se esqueceu a senha, solicite um reset ao proprietário do sistema. Ele gera uma nova senha pelo painel de administração dele.

---

### 1.2 Configurar os dados da clínica

1. Acesse **Configurações**
2. Preencha o **Nome da clínica** (aparece no cabeçalho do painel)
3. Preencha o **Endereço** (opcional)
4. Clique em **Salvar configurações**

---

### 1.3 Configurar os horários de funcionamento

Ainda em **Configurações**, defina os horários em que o bot aceita agendamentos:

| Campo | O que significa |
|---|---|
| Segunda a Sexta — Abertura | Primeiro horário disponível para consulta |
| Segunda a Sexta — Fechamento | Último horário disponível |
| Sábado — Abertura | Se não atende no sábado, defina igual ao fechamento |
| Sábado — Fechamento | Idem |

> O bot nunca oferece horários fora desse intervalo, nem aos domingos.

Clique em **Salvar configurações** ao terminar.

---

### 1.4 Configurar a mensagem de boas-vindas

Ainda em **Configurações**, preencha a **Mensagem de boas-vindas**. Ela é enviada quando o paciente manda a primeira mensagem ou quando o bot não entende a intenção.

**Exemplo:**
> "Olá! Sou a assistente virtual da Clínica Saúde Plena. Posso ajudar você a agendar uma consulta. Com qual especialidade deseja consultar?"

---

### 1.5 Configurar o telefone de fallback

Em **Configurações**, preencha o **Telefone de fallback (recepção)**. Este número é enviado ao paciente quando o bot não consegue ajudar (dúvidas fora do escopo, erros, etc).

**Formato:** apenas números, com código do país e DDD. Ex: `5561999990000`

Clique em **Salvar configurações**.

---

### 1.6 Cadastrar os profissionais

1. Acesse **Profissionais**
2. Clique em **Novo profissional**
3. Preencha:
   - **Nome** — como aparecerá para o paciente no WhatsApp
   - **Especialidade** — como aparecerá no menu de especialidades
   - **Duração da consulta (min)** — define os intervalos entre os horários disponíveis
4. Clique em **Salvar**

Repita para cada profissional da clínica.

> O bot usa os nomes exatamente como cadastrados. Use nomes claros: "Dr. João Silva" e "Clínico Geral" são melhores do que "Dr. João" e "CG".

---

### 1.7 Conectar o WhatsApp

1. Acesse **Configurações**
2. Role até **Conexão WhatsApp**
3. Se o status for "Desconectado", clique em **Ver QR Code**
4. Abra o WhatsApp no celular do número cadastrado na clínica
5. Toque em **⋮ Menu → Dispositivos conectados → Conectar dispositivo**
6. Escaneie o QR Code exibido na tela
7. O status atualiza para "Conectado" automaticamente

> A partir deste momento o bot já está ativo e responderá mensagens recebidas naquele número.

---

### 1.8 Conectar o Google Calendar (opcional, mas recomendado)

Sem o Google Calendar, o bot oferece horários fictícios. Com ele, oferece os horários reais da agenda dos profissionais.

1. Acesse **Configurações**
2. Role até **Conexão Google Calendar**
3. Clique em **Autorizar acesso**
4. Uma nova aba abre com a tela de login do Google
5. Faça login com a conta Google **que contém os calendários dos profissionais** e clique em **Permitir**
6. O sistema salva a autorização e o status muda para "Autorizado"

Depois de autorizar, vincule o calendário de cada profissional:

1. Acesse **Profissionais**
2. Clique no ícone de corrente (🔗) ao lado do profissional
3. O modal lista os calendários disponíveis na conta Google conectada
4. Clique no calendário correspondente ao profissional

> A partir daí, horários já ocupados no Google Calendar não serão oferecidos pelo bot, e cada agendamento confirmado cria automaticamente um evento no calendário do profissional.

---

### Checklist de configuração inicial

- [ ] Login realizado
- [ ] Nome e endereço da clínica preenchidos
- [ ] Horários de funcionamento configurados
- [ ] Mensagem de boas-vindas preenchida
- [ ] Telefone de fallback preenchido
- [ ] Profissionais cadastrados (nome, especialidade, duração)
- [ ] WhatsApp conectado (status "Conectado" em Configurações)
- [ ] Google Calendar autorizado *(opcional)*
- [ ] Calendário vinculado a cada profissional *(opcional, se autorizou o Calendar)*

---

## 2. Dashboard

O Dashboard é a tela inicial do painel. Exibe uma visão geral rápida da clínica.

### 2.1 Cards de métricas

| Card | O que mostra |
|---|---|
| **Agendamentos hoje** | Total de agendamentos confirmados para hoje (exclui cancelados e no-show) |
| **Agendamentos na semana** | Total da semana corrente (domingo a sábado, exclui cancelados e no-show) |
| **Taxa de confirmação** | Percentual de agendamentos confirmados ou concluídos nos últimos 30 dias |

---

### 2.2 Próximos agendamentos

Tabela com os **5 próximos agendamentos confirmados** a partir do momento atual. Exibe:

- Data e hora
- Nome e telefone do paciente
- Nome e especialidade do profissional
- Status atual
- Ações disponíveis

**Ações rápidas na tabela:**

| Botão | O que faz |
|---|---|
| **Concluir** | Marca o agendamento como concluído. Use após a consulta acontecer. |
| **Cancelar** | Cancela o agendamento. Remove o evento do Google Calendar e cancela o lembrete automático pendente. |

> Os dados do Dashboard atualizam automaticamente ao abrir a página. Para atualizar manualmente, recarregue a página.

---

## 3. Agendamentos

Tela com **todos os agendamentos** da clínica, com filtros e paginação.

### 3.1 Filtros disponíveis

| Filtro | Como usar |
|---|---|
| **Data início** | Mostra agendamentos a partir desta data |
| **Data fim** | Mostra agendamentos até esta data |
| **Profissional** | Filtra por profissional específico (dropdown com todos os profissionais) |
| **Status** | Filtra por status: Confirmado, Cancelado, Concluído ou No-show |

Os filtros são aplicados automaticamente ao alterar qualquer campo — não precisa clicar em nenhum botão.

Para **limpar um filtro**, deixe o campo em branco ou selecione "Todos".

---

### 3.2 Tabela de agendamentos

Colunas exibidas:

| Coluna | Descrição |
|---|---|
| **Data / Hora** | Data e horário da consulta |
| **Paciente** | Nome e telefone do paciente |
| **Profissional** | Nome e especialidade |
| **Duração** | Duração da consulta em minutos |
| **Status** | Badge colorido com o status atual |
| **Ações** | Botões disponíveis para o status atual |

---

### 3.3 Ações por status

As ações disponíveis dependem do status atual do agendamento:

| Status atual | Ações disponíveis |
|---|---|
| **Confirmado** | Concluir · No-show · Cancelar |
| **Concluído** | Nenhuma (estado final) |
| **No-show** | Nenhuma (estado final) |
| **Cancelado** | Nenhuma (estado final) |

**O que cada ação faz:**

- **Concluir** — marca a consulta como realizada. Use após a consulta acontecer.
- **No-show** — registra que o paciente não compareceu sem avisar.
- **Cancelar** — cancela a consulta. Remove automaticamente o evento do Google Calendar do profissional e cancela o lembrete pendente no BullMQ (se ainda não foi enviado).

> Atenção: ações de Concluir, No-show e Cancelar são **irreversíveis** pelo painel. Em caso de erro, entre em contato com o proprietário do sistema.

---

### 3.4 Paginação

A lista exibe 20 agendamentos por página. Use os botões **Anterior** e **Próxima** no rodapé da tabela para navegar. O total de agendamentos encontrados aparece no topo da tabela.

---

## 4. Profissionais

Tela para gerenciar os profissionais que o bot oferece aos pacientes.

### 4.1 Lista de profissionais

Cada profissional exibe:
- Inicial do nome (avatar)
- Nome completo
- Especialidade e duração da consulta
- Indicação "Google Calendar vinculado" (se tiver calendário associado)
- Status: **Ativo** (verde) ou **Inativo** (cinza)
- Botões de ação: vincular calendar (🔗), editar (✏️), desativar (🗑️)

---

### 4.2 Criar novo profissional

1. Clique em **Novo profissional**
2. Preencha os campos:

| Campo | Descrição | Obrigatório |
|---|---|---|
| **Nome** | Nome completo como aparecerá para o paciente | Sim |
| **Especialidade** | Ex: "Dermatologia", "Clínico Geral" | Sim |
| **Duração da consulta (min)** | Tempo de cada consulta. Define o intervalo entre os horários disponíveis | Sim (mín. 5) |

3. Clique em **Salvar**

> A duração da consulta impacta diretamente os horários oferecidos pelo bot. Se a duração for 30 min e o horário de funcionamento for 08:00–18:00, os slots disponíveis serão: 08:00, 08:30, 09:00, etc.

---

### 4.3 Editar profissional

1. Clique no ícone de lápis (✏️) ao lado do profissional
2. Altere os campos desejados
3. Ao editar, aparece a opção **"Profissional ativo"** (checkbox) — desmarcar desativa o profissional
4. Clique em **Salvar**

---

### 4.4 Desativar profissional

Clique no ícone de lixeira (🗑️) ao lado do profissional e confirme.

**O que acontece:**
- O profissional **não aparece mais** no menu de especialidades do bot
- Agendamentos **existentes não são apagados** — o histórico é preservado
- O profissional pode ser **reativado** pelo botão de editar

> Use desativar em vez de excluir para preservar o histórico de consultas do profissional.

---

### 4.5 Vincular Google Calendar ao profissional

Pré-requisito: Google Calendar já autorizado em Configurações (ver seção 1.8).

1. Clique no ícone de corrente (🔗) ao lado do profissional
2. O modal lista os calendários disponíveis na conta Google conectada
3. Clique no calendário do profissional para vincular

**Efeito imediato:** o bot passa a consultar a agenda real do profissional. Horários com eventos no Google Calendar não são oferecidos aos pacientes.

Para **desvincular ou trocar** o calendário: clique novamente no ícone de corrente e selecione outro calendário.

---

## 5. Configurações

Central de configurações da clínica e das integrações.

### 5.1 Dados da clínica

| Campo | Descrição |
|---|---|
| **Nome da clínica** | Exibido no cabeçalho do painel |
| **Endereço** | Informativo — não é usado pelo bot atualmente |

Clique em **Salvar configurações** após alterar.

---

### 5.2 Horários de funcionamento

Define quando o bot aceita agendamentos.

| Período | Campos |
|---|---|
| Segunda a Sexta | Abertura e Fechamento |
| Sábado | Abertura e Fechamento |

> **Domingo não é configurável** — o bot nunca oferece horários aos domingos.

> **Se não atende no sábado:** defina Abertura e Fechamento com o mesmo horário (ex: 08:00–08:00). O bot não oferecerá slots nesse dia.

Clique em **Salvar configurações** após alterar.

---

### 5.3 Bot e atendimento

| Campo | Descrição |
|---|---|
| **Mensagem de boas-vindas** | Enviada ao paciente no início da conversa ou quando o bot não entende a mensagem |
| **Telefone de fallback** | Número da recepção enviado ao paciente quando o bot não consegue ajudar. Formato: `5561999990000` |

Clique em **Salvar configurações** após alterar.

---

### 5.4 Conexão WhatsApp

Exibe o status de conexão do WhatsApp da clínica com o bot.

| Status | Significado |
|---|---|
| **Conectado** (verde) | Bot ativo e respondendo mensagens |
| **Desconectado** (vermelho) | Bot inativo — pacientes não recebem respostas |

**Botão "Ver QR Code"** (aparece quando desconectado):
1. Clique em "Ver QR Code"
2. Escaneie com o WhatsApp do número da clínica: **⋮ Menu → Dispositivos conectados → Conectar dispositivo**
3. Aguarde o status mudar para "Conectado"

**Botão "Atualizar":** consulta o status atual sem recarregar a página.

> O WhatsApp pode desconectar espontaneamente (reinicialização de servidor, expiração de sessão). Verifique o status periodicamente ou monitore pelo painel do proprietário.

---

### 5.5 Conexão Google Calendar

Exibe o status da integração com o Google Calendar.

| Status | Significado |
|---|---|
| **Autorizado** (verde) | Integração ativa. O bot consulta calendários reais. |
| **Não autorizado** (vermelho) | O bot usa horários fictícios (mock) |

**Botão "Autorizar acesso"** (aparece quando não autorizado):
1. Clique em "Autorizar acesso"
2. Faça login com a conta Google que contém os calendários dos profissionais
3. Clique em **Permitir** na tela de consentimento do Google
4. O sistema salva a autorização permanentemente — não precisa repetir

> A autorização não expira em condições normais. Se expirar (raro), o botão "Autorizar acesso" voltará a aparecer — basta repetir o processo.

---

## 6. Conversas

Tela para visualizar o histórico de conversas dos pacientes com o bot.

### 6.1 Lista de contatos

O painel esquerdo exibe todos os pacientes que já interagiram com o bot, ordenados pela mensagem mais recente. Cada item mostra:

- Nome do paciente (quando identificado) ou número de telefone
- Prévia da última mensagem
- Total de mensagens trocadas

Use a **barra de busca** no topo para filtrar por nome ou número de telefone.

---

### 6.2 Histórico da conversa

Ao clicar em um contato, o painel direito exibe o histórico completo da conversa em formato de chat:

- **Balões à esquerda (cinza):** mensagens enviadas pelo paciente
- **Balões à direita (verde):** mensagens enviadas pelo bot

O histórico inclui todas as mensagens, incluindo lembretes automáticos enviados pelo sistema.

---

### 6.3 Para que serve esta tela

- Verificar o que o bot respondeu a um paciente específico
- Diagnosticar por que um agendamento não foi concluído
- Identificar pacientes que tiveram dificuldades no fluxo de atendimento
- Auditar o comportamento do bot

> Esta tela é **somente leitura** — não é possível enviar mensagens pelo painel. Para entrar em contato com um paciente, use o WhatsApp diretamente.

---

## 7. Status dos agendamentos — referência

| Status | Cor | Significado | Estado final? |
|---|---|---|---|
| **Confirmado** | Verde | Agendamento ativo, consulta ainda não ocorreu | Não |
| **Concluído** | Azul | Consulta realizada | Sim |
| **Cancelado** | Vermelho | Consulta cancelada (pelo paciente via bot ou pelo admin no painel) | Sim |
| **No-show** | Laranja | Paciente não compareceu sem avisar | Sim |

**Fluxo normal:**
```
Confirmado → Concluído
```

**Fluxos alternativos:**
```
Confirmado → Cancelado  (paciente cancela ou admin cancela)
Confirmado → No-show    (paciente não aparece)
```

---

## 8. Como o bot usa as suas configurações

Esta seção explica o que acontece no WhatsApp quando um paciente escreve, relacionando cada comportamento com a configuração correspondente no painel.

### 8.1 Fluxo completo de um agendamento

1. Paciente envia qualquer mensagem → bot responde com a **Mensagem de boas-vindas** (Configurações)
2. Bot pergunta a especialidade → lista todos os **Profissionais ativos** (Profissionais)
3. Paciente escolhe o profissional → bot exibe **horários disponíveis** dos próximos 5 dias úteis
   - Com Google Calendar: horários reais baseados na agenda e na **Duração da consulta** (Profissionais)
   - Sem Google Calendar: horários fictícios dentro dos **Horários de funcionamento** (Configurações)
4. Paciente escolhe o horário → bot pede confirmação com nome
5. Paciente confirma → agendamento criado no banco + evento no Google Calendar (se vinculado)
6. Paciente pergunta algo fora do escopo → bot responde e fornece o **Telefone de fallback** (Configurações)

### 8.2 Impacto da duração da consulta

A duração definida em **Profissionais** determina os intervalos entre slots:

| Duração | Horários de funcionamento 08:00–18:00 | Slots disponíveis |
|---|---|---|
| 30 min | 08:00–18:00 | 08:00, 08:30, 09:00 ... 17:30 |
| 60 min | 08:00–18:00 | 08:00, 09:00, 10:00 ... 17:00 |
| 45 min | 08:00–18:00 | 08:00, 08:45, 09:30 ... 17:15 |

### 8.3 Quando o bot não aceita mais agendamentos

O bot deixa de funcionar completamente nos seguintes casos:
- WhatsApp **desconectado** — reconecte em Configurações → "Ver QR Code"
- Clínica **desativada** pelo proprietário do sistema — entre em contato com o proprietário

---

## 9. Lembretes automáticos

O sistema envia automaticamente um lembrete de consulta por WhatsApp **24 horas antes** de cada agendamento confirmado.

### 9.1 Como funciona

- O lembrete é enviado apenas para pacientes que aceitaram receber lembretes durante o agendamento
- O conteúdo inclui data, hora, nome do profissional e 3 opções de resposta:
  - **1** — Confirmar presença
  - **2** — Remarcar
  - **3** — Cancelar
- O bot interpreta a resposta e executa a ação correspondente automaticamente

### 9.2 Ajuste para fins de semana

Se o horário ideal para enviar o lembrete cair em sábado ou domingo (ex: consulta na segunda às 10h → lembrete seria no domingo às 10h), o sistema antecipa o envio para **sexta-feira** no mesmo horário.

### 9.3 O que o admin pode fazer em relação aos lembretes

- **Verificar se um lembrete foi enviado:** na tela de Agendamentos, agendamentos que receberam lembrete são normais — não há indicador visual específico no painel atualmente
- **Cancelar a consulta antes do lembrete:** use a ação "Cancelar" em Agendamentos — o lembrete pendente é cancelado automaticamente
- **Paciente que não quer mais receber lembretes:** o próprio paciente pode recusar durante o fluxo de agendamento. Não há como alterar pelo painel atualmente.

---

## 10. Perguntas frequentes

**O bot parou de responder. O que fazer?**
1. Acesse **Configurações → Conexão WhatsApp**
2. Se o status for "Desconectado", clique em "Ver QR Code" e reconecte
3. Se o status for "Conectado", verifique se a clínica não foi desativada pelo proprietário

---

**Um paciente disse que tentou agendar mas não conseguiu. Como investigar?**
1. Acesse **Conversas**
2. Busque pelo nome ou número do paciente
3. Leia o histórico — o bot geralmente explica o motivo quando não consegue completar o agendamento
4. Verifique se há profissional ativo cadastrado para a especialidade solicitada

---

**Adicionei um profissional mas ele não aparece para os pacientes. Por quê?**
- Verifique se o profissional está com status **Ativo** (verde) em Profissionais
- Verifique se o nome e especialidade estão preenchidos corretamente

---

**Um agendamento foi criado no horário errado. Como corrigir?**
Não é possível editar data/hora de um agendamento pelo painel. As opções são:
1. Cancelar o agendamento atual (botão "Cancelar" em Agendamentos)
2. O paciente reagenda pelo WhatsApp com o bot normalmente

---

**O Google Calendar mostra "Não autorizado" de repente. O que fazer?**
1. Acesse **Configurações → Conexão Google Calendar**
2. Clique em "Autorizar acesso" e repita o processo de autorização
3. Não é necessário reconfigurar os calendários dos profissionais — os vínculos são preservados

---

**Como faço para atender no sábado?**
1. Acesse **Configurações → Horários de funcionamento**
2. Defina Abertura e Fechamento do sábado com o horário desejado (ex: 08:00–12:00)
3. Clique em **Salvar configurações**

---

**Como faço para tirar férias / suspender o atendimento temporariamente?**
Opção 1 (sem desativar o bot): defina os horários de funcionamento com abertura e fechamento iguais (ex: 08:00–08:00 em todos os dias). O bot informará que não há horários disponíveis.

Opção 2 (desativa completamente): solicite ao proprietário do sistema para desativar a clínica. O bot não responderá nenhuma mensagem enquanto desativado.

---

**Posso ter mais de um número de WhatsApp no sistema?**
Não. Cada clínica tem um único número de WhatsApp. Para adicionar um segundo número, entre em contato com o proprietário do sistema.

---

*Dúvidas não cobertas por este manual? Entre em contato com o proprietário do sistema AgendaZap.*
