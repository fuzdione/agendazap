import IORedis from 'ioredis';
import { env } from './env.js';

// maxRetriesPerRequest: null é obrigatório para compatibilidade com BullMQ —
// sem isso o BullMQ lança erro ao tentar usar a conexão para filas.
export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    console.log(`🔄 Tentando reconectar ao Redis (tentativa ${times}), aguardando ${delay}ms...`);
    return delay;
  },
  reconnectOnError(err) {
    console.error('❌ Erro no Redis, tentando reconectar:', err.message);
    return true;
  },
});

redis.on('connect', () => {
  console.log('✅ Redis conectado com sucesso');
});

redis.on('error', (err) => {
  console.error('❌ Erro na conexão Redis:', err.message);
});

export async function checkRedisConnection() {
  const result = await redis.ping();
  return result === 'PONG';
}
