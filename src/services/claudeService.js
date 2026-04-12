import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;

// Timeout de 25 segundos para a chamada à API do Claude
const API_TIMEOUT_MS = 25_000;

/**
 * Extrai o bloco JSON de controle das tags <json>...</json> na resposta do Claude.
 * Retorna null se não encontrar ou se o JSON for inválido.
 * @param {string} text
 * @returns {object|null}
 */
function extractControlJson(text) {
  const match = text.match(/<json>([\s\S]*?)<\/json>/i);
  if (!match) return null;

  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Remove as tags <json>...</json> e seu conteúdo do texto para obter
 * apenas a mensagem visível ao paciente.
 * @param {string} text
 * @returns {string}
 */
function extractPatientMessage(text) {
  return text.replace(/<json>[\s\S]*?<\/json>/gi, '').trim();
}

/**
 * Monta o system prompt completo para o Claude, com:
 * - Identidade do bot e dados da clínica
 * - Regras de comportamento
 * - Lista de profissionais e especialidades
 * - Horários disponíveis formatados
 * - Estado atual da conversa e contexto acumulado
 * - Instrução para retornar JSON de controle nas tags <json></json>
 *
 * @param {object} clinica - Registro da tabela clinicas
 * @param {Array} profissionais - Profissionais ativos da clínica
 * @param {Array} horariosDisponiveis - Resultado de generateMockSlots ou Google Calendar
 * @param {object} estadoConversa - Registro atual de estado_conversa (pode ser null)
 * @returns {string}
 */
export function buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, nomesConhecidos = [], agendamentos = []) {
  // Limita a 3 nomes mais recentes para evitar mensagens longas e confusas ao paciente
  nomesConhecidos = nomesConhecidos.slice(-3);
  // Formata a lista de profissionais e especialidades — UUID incluído para extração correta pelo modelo
  const listaProfissionais = profissionais
    .map((p, i) => `  ${i + 1}. ${p.nome} — ${p.especialidade} (consulta de ${p.duracaoConsultaMin} min) [id: ${p.id}]`)
    .join('\n');

  // Formata os horários disponíveis por profissional
  // Limite: 3 dias e 8 horários por dia (WhatsApp-friendly, formato horizontal)
  const MAX_DIAS = 3;
  const MAX_SLOTS_POR_DIA = 8;

  const listaHorarios = horariosDisponiveis
    .map(({ profissional, slots }) => {
      if (!slots || slots.length === 0) return `  ${profissional.nome}: sem horários disponíveis`;

      const diasFormatados = slots.slice(0, MAX_DIAS).map((d) => {
        const [ano, mes, dia] = d.data.split('-');
        const dataFormatada = `${dia}/${mes}/${ano}`;  // ano obrigatório para Claude gerar ISO correto
        const primeiros = d.slots.slice(0, MAX_SLOTS_POR_DIA);
        const extra = d.slots.length - primeiros.length;
        const linhaSlots = primeiros.join(' | ') + (extra > 0 ? ` (+${extra} horários)` : '');
        return `📅 *${d.dia_semana}, ${dataFormatada}:*\n${linhaSlots}`;
      }).join('\n\n');

      return `${profissional.nome} (${profissional.especialidade}):\n${diasFormatados}`;
    })
    .join('\n\n');

  // Data atual em Brasília — injetada no prompt para Claude nunca inferir o ano errado
  const agoraBrasilia = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });

  // Lista de agendamentos confirmados futuros deste telefone (para remarkação/cancelamento)
  const listaAgendamentos = agendamentos.length > 0
    ? agendamentos.map((a) => {
        const dtBrasilia = new Date(a.dataHora).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        return `  - ID: ${a.id} | ${a.paciente.nome} | ${a.profissional.nome} (${a.profissional.especialidade}) | ${dtBrasilia}`;
      }).join('\n')
    : '  (nenhum agendamento futuro)';

  // Estado atual e contexto acumulado da conversa
  const estadoAtual = estadoConversa?.estado ?? 'inicio';
  const contexto = estadoConversa?.contextoJson ?? {};
  const contextoFormatado = JSON.stringify(contexto, null, 2);

  // Instrução de identificação do paciente baseada nos nomes já conhecidos
  const identificacaoPaciente = nomesConhecidos.length > 0
    ? `Pacientes já cadastrados neste telefone: ${nomesConhecidos.join(', ')}.
Quando o paciente escolher o horário, faça esta pergunta antes de confirmar:
"Ótimo! Antes de confirmar, essa consulta é para ${nomesConhecidos.join(' ou ')}? Ou está agendando para outra pessoa?"
- Se confirmar um dos nomes → registre nome_paciente, exiba o resumo completo (profissional, data, horário, nome) e aguarde confirmação explícita ("sim", "confirmo", "pode marcar") antes de usar "acao": "criar_agendamento"
- Se for outra pessoa → peça o nome completo, registre nome_paciente, exiba o resumo e aguarde confirmação explícita
- Nunca use "acao": "criar_agendamento" apenas porque o nome foi informado — é obrigatório mostrar o resumo e receber "sim" do paciente`
    : 'Primeiro contato deste telefone. Ao escolher o horário, pergunte o nome completo com linguagem de transição (ex: "Ótimo! Para confirmar, qual o seu nome completo?"). Após receber o nome, exiba o resumo completo (profissional, data, horário, nome) e aguarde confirmação explícita ("sim", "confirmo") antes de usar "acao": "criar_agendamento".';

  const mensagemBoasVindas = clinica.configJson?.mensagem_boas_vindas;

  return `Você é o assistente virtual da ${clinica.nome}, uma clínica localizada em ${clinica.endereco ?? 'endereço não informado'}.
Seu papel é ajudar pacientes a agendar, remarcar ou cancelar consultas pelo WhatsApp de forma cordial, objetiva e eficiente.
${mensagemBoasVindas ? `\nMensagem de boas-vindas personalizada da clínica (use como referência de tom e saudação):\n"${mensagemBoasVindas}"\n` : ''}

## DATA ATUAL
Hoje é ${agoraBrasilia}. Ao interpretar datas mencionadas pelo paciente e ao gerar o campo "data_hora" no JSON, use sempre o ano atual indicado acima.

## REGRAS DE COMPORTAMENTO
- Seja sempre cordial e objetivo. Use até 2 emojis por mensagem.
- Escreva em português brasileiro.
- Trabalhe exclusivamente com os profissionais e horários listados nas seções abaixo.
- Para questões médicas ou diagnósticos, oriente o paciente a consultar diretamente o profissional de saúde.
- Apresente sempre a lista completa de profissionais para o paciente escolher — isso poupa tempo e evita dúvidas.
- Quando o paciente pedir algo fora do escopo de agendamento, responda com cordialidade e redirecione para o que você pode oferecer.
- Quando a mensagem for vaga ou a confiança na interpretação for baixa, peça esclarecimento de forma amigável.
- Após 3 tentativas sem chegar a um entendimento, sugira que o paciente ligue para a recepção.
- Ao confirmar um agendamento, sempre repita: profissional, especialidade, data e horário.
- Use "agendada", "confirmada" ou "marcada" somente após coletar todos os dados necessários e ao executar acao = "criar_agendamento". Enquanto ainda houver perguntas pendentes (nome, confirmação), use linguagem de transição: "Ótimo! Antes de confirmar..." ou "Quase lá! Só preciso saber...".

## IDENTIFICAÇÃO DO PACIENTE
${identificacaoPaciente}

## PROFISSIONAIS E ESPECIALIDADES DISPONÍVEIS
${listaProfissionais || '  (nenhum profissional cadastrado)'}

## HORÁRIOS DISPONÍVEIS
${listaHorarios || '  (sem horários disponíveis no momento)'}

## AGENDAMENTOS CONFIRMADOS DESTE TELEFONE
${listaAgendamentos}

## ESTADO ATUAL DA CONVERSA
Estado: ${estadoAtual}
Contexto acumulado:
${contextoFormatado}

## FLUXO DA PRIMEIRA INTERAÇÃO

Caso 1 — Mensagem vaga / saudação (ex: "oi", "olá", "bom dia", "boa tarde"):
Use EXATAMENTE este formato (adaptando saudação e nome da clínica):

[saudação adequada ao horário]! Bem-vindo(a) à ${clinica.nome}! 😊

Como posso ajudá-lo(a) hoje?

1️⃣ Agendar uma consulta
2️⃣ Remarcar uma consulta
3️⃣ Cancelar uma consulta

Caso 2 — Mensagem com intenção clara de agendar (ex: "quero marcar", "preciso de consulta", "quero agendar"):
Saudação breve + exiba a lista de profissionais imediatamente, usando emoji numbers (1️⃣ 2️⃣ 3️⃣). Exemplo:
"Olá! 😊 Temos os seguintes profissionais disponíveis — digite o número para escolher:

1️⃣ Dr. João Silva — Clínico Geral (30 min)
2️⃣ Dra. Maria Santos — Dermatologia (40 min)
3️⃣ Dra. Ana Costa — Nutrição (50 min)"

Formato correto para numeração: 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ (e não 1. 2. 3. com ponto).

## SELEÇÃO POR NÚMERO
Quando o paciente responder com um número simples (ex: "1", "2", "3") ou emoji number (ex: "1️⃣", "2️⃣"):
- Se o estado for "inicio" e o menu exibido foi o de opções (agendar/remarcar/cancelar): 1=agendar, 2=remarcar, 3=cancelar.
- Se o estado for "escolhendo_especialidade" e a lista exibida foi a de profissionais: resolva para o profissional correspondente na lista da seção PROFISSIONAIS E ESPECIALIDADES, extraia o profissional_id correto e TRANSCREVA na sua resposta ao paciente as linhas de horários disponíveis desse profissional que constam na seção HORÁRIOS DISPONÍVEIS acima — os horários não são visíveis ao paciente, você precisa copiá-los explicitamente para o texto da resposta. Não diga "vou verificar" nem "aguarde" nem "aqui estão os horários" sem realmente listá-los.
- Quando há uma lista numerada ativa no contexto, interprete sempre números simples como seleção dessa lista.

## FLUXO ESPERADO
inicio → escolhendo_especialidade → escolhendo_horario → confirmando → concluido → volta para inicio

## BLOCO JSON DE CONTROLE — OBRIGATÓRIO EM TODA RESPOSTA
Toda resposta deve terminar com um bloco JSON entre as tags <json></json>, inclusive confirmações finais, encerramentos e respostas curtas.
O agendamento só é registrado no sistema quando este bloco está presente e bem formado — por isso inclua-o sempre.

O JSON deve seguir exatamente este formato:
<json>
{
  "intencao": "agendar|remarcar|cancelar|duvida|saudacao|outro",
  "novo_estado": "inicio|escolhendo_especialidade|escolhendo_horario|confirmando|concluido",
  "dados_extraidos": {
    "especialidade": "string ou null",
    "profissional_id": "UUID do profissional ou null",
    "data_hora": "ISO string (ex: 2026-03-30T09:00:00-03:00) ou null",
    "nome_paciente": "string ou null",
    "agendamento_id": "UUID do agendamento a remarcar/cancelar (da lista acima) ou null"
  },
  "acao": "nenhuma|criar_agendamento|remarcar_agendamento|cancelar_agendamento",
  "confianca": 0.0
}
</json>

Regras para o JSON:
- Use "acao": "criar_agendamento" quando o paciente confirmou explicitamente E todos os campos de dados_extraidos estão preenchidos E não há agendamento anterior a remarcar.
- Use "acao": "remarcar_agendamento" quando o paciente quer mudar data/hora de uma consulta existente e já confirmou o novo horário. Preencha "agendamento_id" com o ID da consulta a ser substituída.
- Ao identificar intenção de remarcar, preencha imediatamente "agendamento_id" com o UUID da lista acima e "intencao": "remarcar" — preserve esses valores em todos os turnos seguintes até a conclusão.
- Quando o paciente está remarcando, use "remarcar_agendamento" — isso garante que o agendamento anterior seja cancelado corretamente.
- "confianca" é um número entre 0.0 e 1.0 indicando sua certeza sobre a interpretação da mensagem.
- Preserve os dados já extraídos em turnos anteriores (disponíveis no contexto acumulado acima).
- Se o paciente escolher por número ou abreviação, resolva para o nome/id correto.

Sua resposta só estará completa quando incluir o bloco <json>...</json> ao final.`;
}

/**
 * Chama a Claude API para processar uma mensagem do paciente e gerar uma resposta.
 *
 * @param {string} messageText - Mensagem atual do paciente
 * @param {string} systemPrompt - System prompt completo montado por buildSystemPrompt()
 * @param {Array} recentHistory - Últimas mensagens da tabela conversas (máx 10)
 * @param {string} estadoAtual - Estado atual da conversa (para fallback do JSON de controle)
 * @returns {{ mensagemParaPaciente: string, controle: object }}
 */
export async function processMessage(messageText, systemPrompt, recentHistory, estadoAtual = 'inicio') {
  // Monta o array de messages com o histórico recente
  const messages = [];

  for (const msg of recentHistory) {
    const role = msg.direcao === 'entrada' ? 'user' : 'assistant';
    // Evita duplicar a mensagem atual que já será adicionada abaixo
    if (msg.mensagem !== messageText || role !== 'user') {
      messages.push({ role, content: msg.mensagem });
    }
  }

  // Garante que a mensagem atual do paciente seja sempre a última
  messages.push({ role: 'user', content: messageText });

  // Fallback padrão caso a API falhe ou o JSON de controle não seja parseável
  const controleFallback = {
    intencao: 'outro',
    novo_estado: estadoAtual,
    dados_extraidos: {
      especialidade: null,
      profissional_id: null,
      data_hora: null,
      nome_paciente: null,
    },
    acao: 'nenhuma',
    confianca: 0.0,
  };

  try {
    // Chama a API com timeout explícito via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response;
    try {
      response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages,
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const fullText = response.content?.[0]?.text ?? '';

    const mensagemParaPaciente = extractPatientMessage(fullText);
    const controleExtraido = extractControlJson(fullText);
    if (!controleExtraido) {
      const temTag = /<json>/i.test(fullText);
      console.error(`[claude] JSON de controle inválido — tag <json> presente: ${temTag}`);
      console.error(`[claude] Últimos 400 chars: ${fullText.slice(-400)}`);
    }
    const controle = controleExtraido ?? controleFallback;

    // Garante que campos obrigatórios existam mesmo que o Claude não os retorne
    if (!controle.dados_extraidos) controle.dados_extraidos = controleFallback.dados_extraidos;
    if (controle.confianca === undefined) controle.confianca = 0.5;

    return { mensagemParaPaciente, controle };

  } catch (err) {
    // Rate limit (429), timeout, erro de servidor (5xx) ou qualquer outra falha
    const isTimeout = err.name === 'AbortError';
    const isRateLimit = err.status === 429;
    const isServerError = err.status >= 500;

    if (isTimeout) {
      console.error('Claude API: timeout após 25s');
    } else if (isRateLimit) {
      console.error('Claude API: rate limit atingido');
    } else if (isServerError) {
      console.error(`Claude API: erro de servidor ${err.status}`);
    } else {
      console.error('Claude API: erro inesperado —', err.message);
    }

    return {
      mensagemParaPaciente:
        'Desculpe, estou com uma instabilidade momentânea. Por favor, tente novamente em alguns instantes. 🙏',
      controle: controleFallback,
    };
  }
}
