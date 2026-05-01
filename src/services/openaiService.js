import OpenAI from 'openai';
import { env } from '../config/env.js';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;
const API_TIMEOUT_MS = 25_000;

// Mesmo system prompt do claudeService — reutiliza a função exportada daqui
export { buildSystemPrompt } from './claudeService.js';

/**
 * Substitui a seção de instrução de formato do system prompt pela versão JSON mode.
 * O OpenAI JSON mode exige que a resposta inteira seja um objeto JSON válido, então
 * pedimos {"mensagem_paciente": "...", "controle": {...}} em vez de tags <json>.
 *
 * IMPORTANTE: este bloco tem que se manter sincronizado com o `## BLOCO JSON DE CONTROLE`
 * de claudeService.js — mesmos estados e mesmos campos em dados_extraidos. Se divergir,
 * o GPT-4o-mini segue este bloco (último do prompt) e perde campos como tipo_consulta /
 * convenio_nome, quebrando o fluxo de convênio.
 */
function adaptSystemPromptForJsonMode(systemPrompt) {
  // Aceita os dois marcadores históricos para garantir que o bloco antigo seja removido
  // em vez de duplicado (a presença de dois blocos de formato confunde o modelo).
  const marcadores = ['## BLOCO JSON DE CONTROLE', '## INSTRUÇÃO OBRIGATÓRIA'];
  let idx = -1;
  for (const m of marcadores) {
    const i = systemPrompt.indexOf(m);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  const base = idx >= 0 ? systemPrompt.substring(0, idx) : systemPrompt;

  return base + `## INSTRUÇÃO OBRIGATÓRIA — FORMATO DE RESPOSTA
Responda SEMPRE com um objeto JSON com exatamente duas chaves:
- "mensagem_paciente": string NÃO-VAZIA com a mensagem que será enviada ao paciente (esta chave é obrigatória em toda resposta)
- "controle": objeto de controle interno

Formato obrigatório (não inclua nada fora deste JSON, e nunca use tags <json>):
{
  "mensagem_paciente": "sua mensagem para o paciente aqui",
  "controle": {
    "intencao": "agendar|remarcar|cancelar|duvida|saudacao|outro",
    "novo_estado": "inicio|escolhendo_convenio|escolhendo_plano|escolhendo_especialidade|escolhendo_horario|confirmando|concluido",
    "dados_extraidos": {
      "especialidade": "string ou null",
      "profissional_id": "UUID do profissional ou null",
      "tipo_consulta": "particular|convenio ou null",
      "convenio_nome": "nome do convênio (ex: Amil) ou null",
      "data_hora": "ISO string (ex: 2026-03-30T09:00:00-03:00) ou null",
      "nome_paciente": "string ou null",
      "agendamento_id": "UUID do agendamento a remarcar/cancelar ou null"
    },
    "acao": "nenhuma|criar_agendamento|remarcar_agendamento|cancelar_agendamento",
    "confianca": 0.0
  }
}

Regras para o controle:
- "acao" deve ser "criar_agendamento" APENAS quando o paciente confirmou explicitamente E todos os campos dados_extraidos estão preenchidos E não há agendamento anterior a cancelar.
- "acao" deve ser "remarcar_agendamento" quando o paciente confirmou novo horário para consulta existente. Preencha "agendamento_id" com o ID da consulta a cancelar.
- "acao" deve ser "cancelar_agendamento" quando o paciente confirmou o cancelamento. Preencha "agendamento_id" com o ID da consulta a cancelar.
- CRÍTICO: Assim que identificar intenção de remarcar ou cancelar, preencha "agendamento_id" imediatamente e preserve em todos os turnos seguintes.
- "confianca" é um número entre 0.0 e 1.0.
- Preserve os dados já extraídos em turnos anteriores (disponíveis no contexto acumulado acima).
- Se o paciente escolher por número ou abreviação, resolva para o nome/id correto.
- Quando a clínica tem convênios, respeite as seções "PERGUNTA SOBRE CONVÊNIO E FLUXO DE ATENDIMENTO" e "PROFISSIONAIS POR TIPO DE ATENDIMENTO" do prompt acima — preencha tipo_consulta e convenio_nome conforme o passo correspondente.
- "mensagem_paciente" NUNCA pode ser vazia ou ausente. Mesmo em respostas de transição, sempre escreva o texto que o paciente verá.`;
}

/**
 * Chama a OpenAI GPT-4o-mini para processar uma mensagem do paciente.
 * Usa JSON mode para garantir que o controle nunca seja omitido.
 * Interface idêntica ao claudeService.processMessage().
 */
export async function processMessage(messageText, systemPrompt, recentHistory, estadoAtual = 'inicio') {
  const systemPromptJsonMode = adaptSystemPromptForJsonMode(systemPrompt);

  const messages = [{ role: 'system', content: systemPromptJsonMode }];

  for (const msg of recentHistory) {
    const role = msg.direcao === 'entrada' ? 'user' : 'assistant';
    if (msg.mensagem !== messageText || role !== 'user') {
      messages.push({ role, content: msg.mensagem });
    }
  }

  messages.push({ role: 'user', content: messageText });

  const controleFallback = {
    intencao: 'outro',
    novo_estado: estadoAtual,
    dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null, agendamento_id: null },
    acao: 'nenhuma',
    confianca: 0.0,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0,
          messages,
          response_format: { type: 'json_object' },
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const fullText = response.choices?.[0]?.message?.content ?? '{}';

    let parsed;
    try {
      parsed = JSON.parse(fullText);
    } catch {
      console.error('[openai] Falha ao parsear JSON mode response:', fullText.slice(0, 300));
      // Mensagem amigável em vez do fallback "probleminha técnico" do webhook —
      // o paciente recebe uma orientação clara para tentar de novo.
      return {
        mensagemParaPaciente: 'Desculpe, não consegui interpretar agora. Pode tentar de novo, por favor? 🙏',
        controle: controleFallback,
      };
    }

    let mensagemParaPaciente = (parsed.mensagem_paciente ?? '').trim();
    const controle = parsed.controle ?? controleFallback;

    if (!controle.dados_extraidos) controle.dados_extraidos = controleFallback.dados_extraidos;
    if (controle.confianca === undefined) controle.confianca = 0.5;

    // Defesa: se o modelo omitir mensagem_paciente, evita que o webhook caia no fallback
    // "probleminha técnico". Loga para diagnóstico e devolve uma reprompt mínima.
    if (!mensagemParaPaciente) {
      console.error('[openai] mensagem_paciente vazio no JSON retornado:', fullText.slice(0, 300));
      mensagemParaPaciente = 'Desculpe, não entendi. Pode reformular sua mensagem, por favor? 🙏';
    }

    return { mensagemParaPaciente, controle };

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const isRateLimit = err.status === 429;
    const isServerError = err.status >= 500;

    if (isTimeout) {
      console.error('OpenAI API: timeout após 25s');
    } else if (isRateLimit) {
      console.error('OpenAI API: rate limit atingido');
    } else if (isServerError) {
      console.error(`OpenAI API: erro de servidor ${err.status}`);
    } else {
      console.error('OpenAI API: erro inesperado —', err.message);
    }

    return {
      mensagemParaPaciente: 'Desculpe, estou com uma instabilidade momentânea. Por favor, tente novamente em alguns instantes. 🙏',
      controle: controleFallback,
    };
  }
}
