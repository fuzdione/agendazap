import OpenAI from 'openai';
import { env } from '../config/env.js';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;
const API_TIMEOUT_MS = 25_000;

function extractControlJson(text) {
  const match = text.match(/<json>([\s\S]*?)<\/json>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function extractPatientMessage(text) {
  return text.replace(/<json>[\s\S]*?<\/json>/gi, '').trim();
}

// Mesmo system prompt do claudeService — reutiliza a função exportada daqui
export { buildSystemPrompt } from './claudeService.js';

/**
 * Chama a OpenAI GPT-4o-mini para processar uma mensagem do paciente.
 * Interface idêntica ao claudeService.processMessage().
 */
export async function processMessage(messageText, systemPrompt, recentHistory, estadoAtual = 'inicio') {
  const messages = [{ role: 'system', content: systemPrompt }];

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
        { model: MODEL, max_tokens: MAX_TOKENS, messages },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const fullText = response.choices?.[0]?.message?.content ?? '';
    const mensagemParaPaciente = extractPatientMessage(fullText);
    const controleExtraido = extractControlJson(fullText);
    if (!controleExtraido) {
      const temTag = /<json>/i.test(fullText);
      console.error(`[openai] JSON de controle inválido — tag <json> presente: ${temTag}`);
      console.error(`[openai] Últimos 400 chars: ${fullText.slice(-400)}`);
    }
    const controle = controleExtraido ?? controleFallback;

    if (!controle.dados_extraidos) controle.dados_extraidos = controleFallback.dados_extraidos;
    if (controle.confianca === undefined) controle.confianca = 0.5;

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
