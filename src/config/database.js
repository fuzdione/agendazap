import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

const logConfig = env.NODE_ENV === 'development'
  ? ['query', 'error', 'warn']
  : ['error'];

export const prisma = new PrismaClient({
  log: logConfig,
});

export async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ Banco de dados conectado com sucesso');
  } catch (error) {
    console.error('❌ Erro ao conectar com o banco de dados:', error.message);
    throw error;
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log('🔌 Conexão com banco de dados encerrada');
}
