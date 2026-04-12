/**
 * Configuração global do ambiente de testes.
 * Executado pelo Vitest antes de cada arquivo de teste (setupFiles).
 * Define as variáveis de ambiente mínimas para que env.js não encerre o processo.
 */

// Só seta se ainda não estiver definido — respeita valores do .env real se presente
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/testdb';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.EVOLUTION_API_URL ??= 'http://localhost:8080';
process.env.EVOLUTION_API_KEY ??= 'test-evolution-key';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:3000/auth/google/callback';
process.env.JWT_SECRET ??= 'test-secret-minimum-16chars!!';
