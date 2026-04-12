import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

// Mock do banco de dados
vi.mock('../../config/database.js', () => ({
  prisma: {
    clinica: {
      findFirst: vi.fn(),
    },
    paciente: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversa: {
      create: vi.fn(),
    },
  },
}));

// Mock do serviço WhatsApp
vi.mock('../../services/whatsappService.js', () => ({
  sendTextMessage: vi.fn(),
}));

// Mock do conversationService — testes de estado estão em conversationService.test.js
vi.mock('../../services/conversationService.js', () => ({
  handleIncomingMessage: vi.fn().mockResolvedValue('Olá! Sou o assistente da Clínica Teste. Como posso ajudar?'),
}));

// Mock das variáveis de ambiente (evita carregar o .env nos testes)
vi.mock('../../config/env.js', () => ({
  env: {
    PORT: 3000,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret',
    DATABASE_URL: 'postgresql://test',
    REDIS_URL: 'redis://test',
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'test-key',
    CLAUDE_API_KEY: 'sk-ant-test',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/callback',
  },
}));

import { prisma } from '../../config/database.js';
import { sendTextMessage } from '../../services/whatsappService.js';
import { whatsappWebhookRoutes } from '../whatsapp.js';

// --- Helpers de teste ---

const CLINICA_MOCK = {
  id: 'clinica-uuid-001',
  nome: 'Clínica Teste',
  telefoneWpp: '5561995535135',
  ativo: true,
};

const PACIENTE_MOCK = {
  id: 'paciente-uuid-001',
  clinicaId: 'clinica-uuid-001',
  telefone: '5511999990001',
};

/** Constrói um payload de webhook messages.upsert */
function buildPayload({ remoteJid, fromMe = false, text = null, instance = '5561995535135' } = {}) {
  return {
    event: 'messages.upsert',
    instance,
    data: {
      key: { remoteJid, fromMe, id: 'MSG-TEST-001' },
      message: text ? { conversation: text } : { imageMessage: { url: 'http://img' } },
    },
  };
}

/** Simula uma chamada POST ao webhook via Fastify inject */
async function callWebhook(payload) {
  const Fastify = (await import('fastify')).default;
  const app = Fastify({ logger: false });
  await app.register(whatsappWebhookRoutes);
  await app.ready();

  const response = await app.inject({
    method: 'POST',
    url: '/webhook/whatsapp',
    payload,
  });

  // O webhook retorna 200 imediatamente e processa via setImmediate.
  // Aguarda todos os setImmediates e suas cadeias de promises resolverem.
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve(); // flush microtask queue restante

  await app.close();
  return { status: response.statusCode, body: response.json() };
}

// --- Testes ---

describe('Webhook /webhook/whatsapp — filtros', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.clinica.findFirst.mockResolvedValue(CLINICA_MOCK);
    prisma.paciente.findFirst.mockResolvedValue(PACIENTE_MOCK);
    prisma.paciente.findUnique.mockResolvedValue(PACIENTE_MOCK);
    prisma.paciente.create.mockResolvedValue(PACIENTE_MOCK);
    prisma.paciente.update.mockResolvedValue(PACIENTE_MOCK);
    prisma.conversa.create.mockResolvedValue({});
    sendTextMessage.mockResolvedValue({});
  });

  it('ignora eventos que não são messages.upsert', async () => {
    const { status, body } = await callWebhook({ event: 'connection.update', data: {} });

    expect(status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(prisma.clinica.findFirst).not.toHaveBeenCalled();
  });

  it('ignora mensagens enviadas por nós mesmos (fromMe=true)', async () => {
    const { status } = await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', fromMe: true, text: 'Oi' })
    );

    expect(status).toBe(200);
    expect(prisma.clinica.findFirst).not.toHaveBeenCalled();
  });

  it('ignora mensagens de grupos (@g.us)', async () => {
    const { status } = await callWebhook(
      buildPayload({ remoteJid: '556181293323-001@g.us', text: 'Mensagem no grupo' })
    );

    expect(status).toBe(200);
    expect(prisma.clinica.findFirst).not.toHaveBeenCalled();
  });

  it('ignora status/broadcast do WhatsApp', async () => {
    const { status } = await callWebhook(
      buildPayload({ remoteJid: 'status@broadcast', text: 'Status' })
    );

    expect(status).toBe(200);
    expect(prisma.clinica.findFirst).not.toHaveBeenCalled();
  });

  it('ignora mensagens com @lid (formato não suportado pela Evolution API)', async () => {
    const { status } = await callWebhook(
      buildPayload({ remoteJid: '276063401816202@lid', text: 'Oi' })
    );

    expect(status).toBe(200);
    // @lid é ignorado antes de buscar a clínica — Evolution API não suporta enviar para esse formato
    expect(prisma.clinica.findFirst).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('ignora mensagem de número sem clínica cadastrada', async () => {
    prisma.clinica.findFirst.mockResolvedValue(null);

    const { status } = await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', text: 'Oi', instance: 'instancia-inexistente' })
    );

    expect(status).toBe(200);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('processa mensagem de texto normal e envia resposta', async () => {
    const { status } = await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', text: 'Quero agendar' })
    );

    expect(status).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledOnce();
    expect(sendTextMessage).toHaveBeenCalledWith(
      '5561995535135',
      '5511999990001@s.whatsapp.net',
      expect.stringContaining('Clínica Teste')
    );
  });

  it('mensagem de texto salva entrada e saída no banco', async () => {
    await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', text: 'Quero agendar' })
    );

    expect(prisma.conversa.create).toHaveBeenCalledTimes(2);

    const chamadas = prisma.conversa.create.mock.calls;
    expect(chamadas[0][0].data.direcao).toBe('entrada');
    expect(chamadas[1][0].data.direcao).toBe('saida');
  });

  it('mensagem de mídia recebe aviso de limitação e não processa como conversa', async () => {
    const { status } = await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', text: null })
    );

    expect(status).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledOnce();
    expect(sendTextMessage).toHaveBeenCalledWith(
      '5561995535135',
      '5511999990001@s.whatsapp.net',
      expect.stringContaining('texto')
    );
    // Não salva no banco (paciente ainda não foi buscado)
    expect(prisma.conversa.create).not.toHaveBeenCalled();
  });

  it('cria paciente automaticamente se não existir', async () => {
    prisma.paciente.findFirst.mockResolvedValue(null);

    await callWebhook(
      buildPayload({ remoteJid: '5511888880001@s.whatsapp.net', text: 'Primeiro contato' })
    );

    expect(prisma.paciente.create).toHaveBeenCalledOnce();
    expect(prisma.paciente.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ telefone: '5511888880001' }),
    });
  });

  it('não cria paciente duplicado se já existir', async () => {
    prisma.paciente.findFirst.mockResolvedValue(PACIENTE_MOCK);

    await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', text: 'Segunda mensagem' })
    );

    expect(prisma.paciente.create).not.toHaveBeenCalled();
  });

  it('retorna 200 mesmo quando ocorre erro interno (não reenviar pela Evolution API)', async () => {
    prisma.clinica.findFirst.mockRejectedValue(new Error('DB offline'));

    const { status, body } = await callWebhook(
      buildPayload({ remoteJid: '5511999990001@s.whatsapp.net', text: 'Oi' })
    );

    expect(status).toBe(200);
    expect(body).toEqual({ received: true });
  });
});
