import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Define e valida todas as variáveis de ambiente na inicialização.
// Se alguma estiver ausente ou inválida, o processo encerra imediatamente
// com mensagem clara — evita erros silenciosos em runtime.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatória'),
  EVOLUTION_API_URL: z.string().url('EVOLUTION_API_URL deve ser uma URL válida'),
  EVOLUTION_API_KEY: z.string().min(1, 'EVOLUTION_API_KEY é obrigatória'),
  CLAUDE_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  AI_PROVIDER: z.enum(['claude', 'openai']).default('claude'),
  TEST_PHONE_WHITELIST: z.string().optional().default(''),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID é obrigatória'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET é obrigatória'),
  GOOGLE_REDIRECT_URI: z.string().url('GOOGLE_REDIRECT_URI deve ser uma URL válida'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter pelo menos 16 caracteres'),
  ADMIN_URL: z.string().url().optional(),
  SERVER_URL: z.string().url().optional(),
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas ou ausentes:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = {
  ...parsed.data,
  PORT: parseInt(parsed.data.PORT, 10),
};
