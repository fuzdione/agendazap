import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { prisma, connectDatabase, disconnectDatabase } from './config/database.js';
import { redis, checkRedisConnection } from './config/redis.js';
import { whatsappWebhookRoutes } from './webhooks/whatsapp.js';
import { instanceRoutes } from './routes/admin/instance.js';
import { googleAuthRoutes } from './routes/admin/googleAuth.js';
import { professionalsRoutes } from './routes/admin/professionals.js';
import { devSimulateRoutes } from './routes/dev/simulate.js';
import { authRoutes } from './routes/auth/login.js';
import { dashboardRoutes } from './routes/admin/dashboard.js';
import { agendamentosAdminRoutes } from './routes/admin/agendamentos.js';
import { profissionaisCrudRoutes } from './routes/admin/profissionaisCrud.js';
import { conveniosRoutes } from './routes/admin/convenios.js';
import { configuracoesRoutes } from './routes/admin/configuracoes.js';
import { conversasAdminRoutes } from './routes/admin/conversas.js';
import { ownerAuthRoutes } from './routes/owner/auth.js';
import { ownerDashboardRoutes } from './routes/owner/dashboard.js';
import { ownerClinicasRoutes } from './routes/owner/clinicas.js';
import { ownerInstanciasRoutes } from './routes/owner/instancias.js';
import { authenticateOwner } from './middleware/authenticateOwner.js';
import { scannerQueue } from './config/queues.js';
import { sendReminderWorker } from './jobs/sendReminder.js';
import { checkReminderResponseWorker } from './jobs/checkReminderResponse.js';
import { reminderScannerWorker } from './jobs/reminderScanner.js';

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
// Extrai só a origem (scheme + host) do ADMIN_URL e OWNER_URL — paths não são válidos como origin CORS
const adminOrigin = env.ADMIN_URL ? new URL(env.ADMIN_URL).origin : null;
const ownerOrigin = env.OWNER_URL ? new URL(env.OWNER_URL).origin : null;
const allowedOrigins = [adminOrigin, ownerOrigin].filter(Boolean);
await server.register(cors, {
  origin: env.NODE_ENV === 'development' ? true : (allowedOrigins.length > 0 ? allowedOrigins : false),
  credentials: true,
});

await server.register(jwt, {
  secret: env.JWT_SECRET,
});

// Rate limiting global — usa store in-memory (adequado para instância única)
// Redis não é usado aqui para evitar que falhas de conexão Redis quebrem o login
await server.register(rateLimit, {
  global: false,
});

// Decorator de autenticação para admins de clínica
server.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// Decorator de autenticação para o proprietário da solução (role="owner")
server.decorate('authenticateOwner', authenticateOwner);

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

// Rotas do painel administrativo
await server.register(authRoutes);
await server.register(dashboardRoutes);
await server.register(agendamentosAdminRoutes);
await server.register(profissionaisCrudRoutes);
await server.register(conveniosRoutes);
await server.register(configuracoesRoutes);
await server.register(conversasAdminRoutes);

// Rotas do painel do proprietário (owner)
await server.register(ownerAuthRoutes);
await server.register(ownerDashboardRoutes);
await server.register(ownerClinicasRoutes);
await server.register(ownerInstanciasRoutes);

// Rotas de desenvolvimento — simulador de mensagens (apenas NODE_ENV=development)
await server.register(devSimulateRoutes);

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Encerrando servidor...');
  await server.close();
  await sendReminderWorker.close();
  await checkReminderResponseWorker.close();
  await reminderScannerWorker.close();
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

  // Registra o cron de varredura horária de lembretes
  // O jobId garante deduplicação — reinicializações não criam jobs duplicados
  await scannerQueue.add('scan-upcoming', {}, {
    repeat: { every: 60 * 60 * 1000 }, // a cada 1 hora
    jobId: 'reminder-scanner',
  });
  console.log('⏰ Cron de varredura de lembretes registrado (intervalo: 1h)');
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
