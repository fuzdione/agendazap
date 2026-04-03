import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';
import { prisma, connectDatabase, disconnectDatabase } from './config/database.js';
import { redis, checkRedisConnection } from './config/redis.js';
import { whatsappWebhookRoutes } from './webhooks/whatsapp.js';
import { instanceRoutes } from './routes/admin/instance.js';
import { googleAuthRoutes } from './routes/admin/googleAuth.js';
import { professionalsRoutes } from './routes/admin/professionals.js';
import { devSimulateRoutes } from './routes/dev/simulate.js';

const server = Fastify({
  logger: {
    transport: env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
  bodyLimit: 10485760, // 10MB — Evolution API pode enviar payloads grandes com mídia
});

// Plugins
await server.register(cors, {
  origin: env.NODE_ENV === 'development' ? true : false,
});

await server.register(jwt, {
  secret: env.JWT_SECRET,
});

// Rota de health check
server.get('/health', async (request, reply) => {
  const checks = {
    db: false,
    redis: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch (err) {
    server.log.error('Health check — erro no banco de dados:', err.message);
  }

  try {
    checks.redis = await checkRedisConnection();
  } catch (err) {
    server.log.error('Health check — erro no Redis:', err.message);
  }

  const allHealthy = checks.db && checks.redis;

  return reply.status(allHealthy ? 200 : 503).send({
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: checks,
  });
});

// Rotas
await server.register(whatsappWebhookRoutes);
await server.register(instanceRoutes);
await server.register(googleAuthRoutes);
await server.register(professionalsRoutes);

// Rotas de desenvolvimento — simulador de mensagens (apenas NODE_ENV=development)
await server.register(devSimulateRoutes);

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Encerrando servidor...');
  await server.close();
  await disconnectDatabase();
  redis.disconnect();
  console.log('👋 Servidor encerrado com sucesso');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Inicialização
try {
  await connectDatabase();
  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`🚀 AgendaZap rodando em http://0.0.0.0:${env.PORT}`);

  // Diagnóstico de credenciais Google (primeiros 10 chars — nunca loga o valor completo)
  console.log(`🔑 GOOGLE_CLIENT_ID:     ${env.GOOGLE_CLIENT_ID?.slice(0, 10)}...`);
  console.log(`🔑 GOOGLE_CLIENT_SECRET: ${env.GOOGLE_CLIENT_SECRET?.slice(0, 10)}...`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
