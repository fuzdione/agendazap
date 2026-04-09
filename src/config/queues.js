import { Queue } from 'bullmq';
import { redis } from './redis.js';

// Fila principal de lembretes — processa envios para o WhatsApp
export const remindersQueue = new Queue('reminders', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 300000 }, // 5 min — API WhatsApp precisa de tempo real
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 100 },
  },
});

// Fila de verificação de resposta — detecta não-resposta 4h após o lembrete
export const checkResponseQueue = new Queue('check-response', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 50 },
  },
});

// Fila do cron de varredura horária — enfileira lembretes das próximas horas
export const scannerQueue = new Queue('reminder-scanner', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

console.log('✅ Filas BullMQ inicializadas: reminders, check-response, reminder-scanner');
