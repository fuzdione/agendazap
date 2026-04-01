/**
 * Seletor de provider de IA.
 * Exporta buildSystemPrompt e processMessage do provider configurado em AI_PROVIDER.
 *
 * AI_PROVIDER=claude  → usa Anthropic Claude (padrão)
 * AI_PROVIDER=openai  → usa OpenAI GPT-4o-mini
 */
import { env } from '../config/env.js';

const provider = (env.AI_PROVIDER ?? 'claude').toLowerCase();

let service;

if (provider === 'openai') {
  service = await import('./openaiService.js');
} else {
  service = await import('./claudeService.js');
}

export const { buildSystemPrompt, processMessage } = service;
