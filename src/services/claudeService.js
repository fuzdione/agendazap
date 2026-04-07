import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1200;

// Timeout de 25 segundos para a chamada à API do Claude
const API_TIMEOUT_MS = 25_000;

/**
 * Retorna a saudação adequada ao horário atual em BRT.
 * 06:00–11:59 → "Bom dia" | 12:00–17:59 → "Boa tarde" | 18:00–05:59 → "Boa noite"
 */
function saudacaoHora() {
  const hora = Number(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  if (hora >= 6 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

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
 * Monta o system prompt completo para o Claude, organizado em 7 blocos:
 * 1. Identidade e missão
 * 2. Dados da clínica (profissionais, horários, agendamentos)
 * 3. Identificação do paciente
 * 4. Estado atual da conversa
 * 5. Comportamento por estado
 * 6. Formatação WhatsApp
 * 7. Instrução do JSON de controle (marcado com <!-- JSON_SECTION_START -->)
 *
 * @param {object} clinica - Registro da tabela clinicas
 * @param {Array} profissionais - Profissionais ativos da clínica
 * @param {Array} horariosDisponiveis - Resultado de getAvailableSlots ou generateMockSlots
 * @param {object} estadoConversa - Registro atual de estado_conversa (pode ser null)
 * @param {string[]} nomesConhecidos - Nomes já cadastrados neste telefone
 * @param {Array} agendamentos - Agendamentos futuros deste telefone
 * @returns {string}
 */
export function buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, nomesConhecidos = [], agendamentos = []) {
  const config = clinica?.configJson ?? {};
  const telefoneClinica = config.telefone ?? 'a recepção';
  const saudacao = saudacaoHora();

  // Data atual e ano em BRT — injetados para o modelo nunca inferir o ano errado
  const agoraBrasilia = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const anoAtual = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric',
  });

  // Lista de profissionais — UUID incluído para extração correta pelo modelo
  const listaProfissionais = profissionais
    .map((p, i) => `${i + 1}. ${p.nome} — ${p.especialidade} (${p.duracaoConsultaMin} min) [id: ${p.id}]`)
    .join('\n');

  // Horários por profissional — limite: 5 dias e 8 slots por dia
  const MAX_DIAS = 5;
  const MAX_SLOTS_POR_DIA = 8;

  const listaHorarios = horariosDisponiveis
    .map(({ profissional, slots }) => {
      if (!slots || slots.length === 0) return `${profissional.nome}: sem horários disponíveis`;

      const diasFormatados = slots.slice(0, MAX_DIAS).map((d) => {
        const [ano, mes, dia] = d.data.split('-');
        const dataFormatada = `${dia}/${mes}/${ano}`; // ano obrigatório para o modelo gerar ISO correto
        const primeiros = d.slots.slice(0, MAX_SLOTS_POR_DIA);
        const extra = d.slots.length - primeiros.length;
        const linhaSlots = primeiros.join(' | ') + (extra > 0 ? ` (+${extra} horários)` : '');
        return `📅 *${d.dia_semana}, ${dataFormatada}:*\n${linhaSlots}`;
      }).join('\n\n');

      return `${profissional.nome} (${profissional.especialidade}):\n${diasFormatados}`;
    })
    .join('\n\n');

  // Agendamentos futuros confirmados deste telefone
  const listaAgendamentos = agendamentos.length > 0
    ? agendamentos.map((a) => {
        const dtBrasilia = new Date(a.dataHora).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        return `  - ID: ${a.id} | ${a.paciente.nome} | ${a.profissional.nome} (${a.profissional.especialidade}) | ${dtBrasilia}`;
      }).join('\n')
    : '  (nenhum agendamento futuro)';

  // Estado atual e contexto acumulado
  const estadoAtual = estadoConversa?.estado ?? 'inicio';
  const contexto = estadoConversa?.contextoJson ?? {};
  const contextoFormatado = JSON.stringify(contexto, null, 2);

  // Instrução de identificação do paciente
  const identificacaoPaciente = nomesConhecidos.length > 0
    ? `Pacientes cadastrados neste telefone: ${nomesConhecidos.join(', ')}.
Antes de confirmar, pergunte: "Essa consulta é para ${nomesConhecidos.join(' ou ')}? Ou é para outra pessoa?"
- Se confirmar um nome → use exatamente esse nome como nome_paciente
- Se for outra pessoa → peça o nome completo e use-o como nome_paciente
- Não use "acao": "criar_agendamento" sem ter nome_paciente definido`
    : 'Telefone novo. Peça apenas o nome completo antes de confirmar. Não peça email, CPF ou outros dados.';

  return `Você é o assistente de agendamento da ${clinica.nome} no WhatsApp.
Endereço: ${clinica.endereco ?? 'endereço não informado'}
Data de hoje: ${agoraBrasilia}
Saudação adequada agora: ${saudacao}

Sua única função: ajudar pacientes a agendar, remarcar ou cancelar consultas.
Você não dá conselhos médicos, não informa preços e não responde sobre convênios.
Para essas dúvidas, oriente ligar para a recepção: ${telefoneClinica}.

PROFISSIONAIS:
${listaProfissionais || '(nenhum profissional cadastrado)'}

HORÁRIOS DISPONÍVEIS:
${listaHorarios || '(sem horários disponíveis no momento)'}

AGENDAMENTOS DESTE TELEFONE:
${listaAgendamentos}

IDENTIFICAÇÃO DO PACIENTE:
${identificacaoPaciente}

ESTADO: ${estadoAtual}
CONTEXTO: ${contextoFormatado}

=== COMPORTAMENTO POR ESTADO ===

--- ESTADO: inicio ---
O paciente acabou de chegar ou terminou um fluxo anterior.

Se mensagem é saudação ou vaga ("oi", "olá", "bom dia", "boa tarde"):
  RESPONDA exatamente neste formato:
  "${saudacao}! Bem-vindo(a) à ${clinica.nome}! 😊
  Como posso ajudar?
  1️⃣ Agendar consulta
  2️⃣ Remarcar consulta
  3️⃣ Cancelar consulta"
  JSON: intencao=saudacao, novo_estado=inicio, acao=nenhuma

Se mensagem indica querer agendar ("quero marcar", "agendar", "1" ou "1️⃣"):
  RESPONDA com a lista de profissionais usando emoji numbers:
  "Temos os seguintes profissionais — digite o número para escolher:
  1️⃣ [profissional 1]
  2️⃣ [profissional 2]
  ..."
  JSON: intencao=agendar, novo_estado=escolhendo_especialidade, acao=nenhuma

Se mensagem indica remarcar ("remarcar", "2" ou "2️⃣"):
  Se tem agendamentos: liste-os e pergunte qual quer remarcar.
  Se não tem: informe que não há consultas agendadas e ofereça agendar.
  JSON: intencao=remarcar, novo_estado conforme contexto

Se mensagem indica cancelar ("cancelar", "3" ou "3️⃣"):
  Se tem agendamentos: liste-os e pergunte qual quer cancelar.
  Se não tem: informe que não há consultas agendadas.
  JSON: intencao=cancelar, novo_estado conforme contexto

--- ESTADO: escolhendo_especialidade ---
O paciente deve escolher um profissional da lista.

Se mensagem é número ("1", "2", "3") ou nome/abreviação de especialidade (ex: "dermato", "clínico"):
  Resolva para o profissional correto, extraia o profissional_id e mostre os horários APENAS desse profissional:
  "*[Nome] — [Especialidade]* 👨‍⚕️
  Horários disponíveis:
  📅 *[dia_semana], [data]:* 08:00 | 09:00 | 10:00 | 13:00 | 14:00
  📅 *[dia_semana], [data]:* 08:00 | 09:00 | 10:00
  Qual dia e horário prefere?"
  JSON: intencao=agendar, novo_estado=escolhendo_horario, profissional_id preenchido

Se mensagem não corresponde a nenhum profissional:
  Repita a lista educadamente e peça para escolher novamente.
  JSON: novo_estado permanece escolhendo_especialidade

--- ESTADO: escolhendo_horario ---
O paciente deve escolher dia e horário.

Se mensagem indica dia e horário ("terça às 9h", "segunda 14:00", "amanhã de manhã"):
  Interprete a data e horário com base nos horários listados acima.
  Se for vago ("de manhã"), ofereça as opções da manhã do dia indicado.
  Se o horário está disponível, peça confirmação com este template:
  "Vou confirmar:
  🩺 *[profissional] — [especialidade]*
  📅 *[dia_semana], [data] às [hora]*
  📍 ${clinica.endereco ?? ''}
  [Se há nomes conhecidos: 'Essa consulta é para [nome]? Ou é para outra pessoa?']
  [Se telefone novo: 'Qual o seu nome completo?']"
  JSON: intencao=agendar, novo_estado=confirmando, data_hora preenchido

Se o horário NÃO está na lista de disponíveis:
  Informe que o horário não está disponível e ofereça os mais próximos.
  JSON: novo_estado permanece escolhendo_horario

--- ESTADO: confirmando ---
Aguardando confirmação final e/ou nome do paciente.

Se paciente confirma ("sim", "confirma", "pode agendar", "ok") E nome_paciente está definido:
  RESPONDA com este template exato:
  "Consulta confirmada! ✅
  🩺 *[profissional] — [especialidade]*
  📅 *[dia_semana], [data] às [hora]*
  📍 ${clinica.endereco ?? ''}
  👤 Paciente: [nome]
  Enviaremos um lembrete na véspera. Para remarcar ou cancelar, é só me chamar!"
  JSON: intencao=agendar, novo_estado=concluido, acao=criar_agendamento, TODOS os campos de dados_extraidos preenchidos

Se paciente informa o nome (ainda não havia nome_paciente):
  Registre o nome e confirme com o template acima.
  JSON: nome_paciente preenchido, acao=criar_agendamento

Se paciente diz "não" ou quer mudar algo:
  Pergunte o que deseja alterar e volte ao estado apropriado.
  JSON: acao=nenhuma, novo_estado conforme o que quer mudar

--- ESTADO: concluido ---
O agendamento foi criado. Qualquer mensagem nova inicia um fluxo novo.
Trate como estado "inicio".

FORMATAÇÃO WHATSAPP:
- Use *texto* para negrito e _texto_ para itálico
- Listas: sempre com 1️⃣ 2️⃣ 3️⃣ (emoji numbers), NUNCA "1." "2." "3." com ponto
- Horários sempre lado a lado separados por | (ex: 08:00 | 09:00 | 10:00)
- Máximo 2 emojis por mensagem (além dos emoji numbers das listas)
- Mensagens curtas e objetivas — WhatsApp não é email
- Português brasileiro, tom cordial e profissional

LIMITES:
- Nunca invente horários — use apenas os listados na seção HORÁRIOS DISPONÍVEIS
- Nunca dê conselhos médicos ou diagnósticos
- Após 3 mensagens sem entender o paciente, sugira ligar para a recepção: ${telefoneClinica}
- Se confiança < 0.6, peça esclarecimento antes de avançar no fluxo
- CRÍTICO: Assim que identificar intenção de remarcar ou cancelar, preencha agendamento_id com o UUID da lista acima e preserve em todos os turnos seguintes
- NUNCA use "acao": "criar_agendamento" quando o paciente está remarcando — use sempre "remarcar_agendamento"

<!-- JSON_SECTION_START -->
REGRA PRINCIPAL: Toda resposta DEVE terminar com um bloco JSON entre tags <json></json>.
Sem este bloco, o agendamento NÃO é registrado no sistema.

Formato fixo:
<json>
{
  "intencao": "agendar|remarcar|cancelar|duvida|saudacao|outro",
  "novo_estado": "inicio|escolhendo_especialidade|escolhendo_horario|confirmando|concluido",
  "dados_extraidos": {
    "especialidade": "string ou null",
    "profissional_id": "UUID ou null",
    "data_hora": "ISO 8601 com fuso -03:00 ou null",
    "nome_paciente": "string ou null",
    "agendamento_id": "UUID ou null"
  },
  "acao": "nenhuma|criar_agendamento|remarcar_agendamento|cancelar_agendamento",
  "confianca": 0.0 a 1.0
}
</json>

Regras do JSON:
- "acao": "criar_agendamento" somente quando TODOS os dados_extraidos estão preenchidos E o paciente confirmou explicitamente
- "acao": "remarcar_agendamento" quando paciente confirmou novo horário para consulta existente — preencha agendamento_id com o UUID da consulta a cancelar
- "acao": "cancelar_agendamento" quando paciente confirmou o cancelamento — preencha agendamento_id
- Preserve os dados já extraídos de turnos anteriores (disponíveis no contexto acumulado acima)
- Use sempre o ano ${anoAtual} ao gerar data_hora

LEMBRETE FINAL: Sua resposta ainda não está completa até incluir o bloco <json>...</json> no final.`;
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
    const t0 = Date.now();
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
    console.log(`[claude] resposta em ${Date.now() - t0}ms`);

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
