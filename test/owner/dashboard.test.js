/**
 * Testes do dashboard do painel do proprietário.
 *
 * Cobre:
 * - Retorna contagens corretas de clínicas e agendamentos
 * - Infraestrutura: db ok quando $queryRaw resolve, db falho quando rejeita
 * - Alertas: clínica com WhatsApp desconectado aparece na lista
 * - Alertas: clínica com WhatsApp conectado não aparece
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    usuarioOwner: { findUnique: vi.fn() },
    clinica: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agendamento: { count: vi.fn() },
    usuarioAdmin: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../src/config/redis.js', () => ({
  redis: { ping: vi.fn().mockResolvedValue('PONG'), disconnect: vi.fn() },
  checkRedisConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/whatsappService.js', () => ({
  getInstanceStatus: vi.fn(),
  createInstance: vi.fn(),
  getQRCode: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { buildApp, gerarTokenOwner } from '../helpers/buildApp.js';
import { prisma } from '../../src/config/database.js';
import { checkRedisConnection } from '../../src/config/redis.js';
import { getInstanceStatus } from '../../src/services/whatsappService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(ok = true) {
  global.fetch = vi.fn().mockResolvedValue({ ok });
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('GET /owner/dashboard', () => {
  let app;
  let token;

  beforeAll(async () => {
    app = await buildApp();
    token = gerarTokenOwner(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restaura fetch global após cada teste
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  it('retorna contagens corretas de clínicas e agendamentos', async () => {
    prisma.clinica.count
      .mockResolvedValueOnce(3)  // clinicasAtivas
      .mockResolvedValueOnce(1); // clinicasInativas
    prisma.agendamento.count
      .mockResolvedValueOnce(12) // agendamentosHoje
      .mockResolvedValueOnce(47); // agendamentosSemana
    prisma.clinica.findMany.mockResolvedValueOnce([]); // clinicas para alerta
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]); // db health ok
    checkRedisConnection.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.clinicasAtivas).toBe(3);
    expect(data.clinicasInativas).toBe(1);
    expect(data.agendamentosHoje).toBe(12);
    expect(data.agendamentosSemana).toBe(47);
    expect(data.alertas).toEqual([]);
  });

  it('inclui alerta quando clínica ativa tem WhatsApp desconectado', async () => {
    const clinicaDesconectada = {
      id: 'clinica-des-uuid',
      nome: 'Clínica Desconectada',
      telefoneWpp: '5511999998888',
    };

    prisma.clinica.count.mockResolvedValue(1);
    prisma.agendamento.count.mockResolvedValue(0);
    prisma.clinica.findMany.mockResolvedValueOnce([clinicaDesconectada]);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    checkRedisConnection.mockResolvedValueOnce(true);

    // Simula WhatsApp desconectado (state !== 'open')
    getInstanceStatus.mockResolvedValueOnce({ instance: { state: 'close' } });

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.alertas).toHaveLength(1);
    expect(data.alertas[0].tipo).toBe('whatsapp_desconectado');
    expect(data.alertas[0].clinicaId).toBe(clinicaDesconectada.id);
    expect(data.alertas[0].clinica).toBe(clinicaDesconectada.nome);
  });

  it('NÃO inclui alerta quando WhatsApp está conectado (state=open)', async () => {
    const clinicaConectada = {
      id: 'clinica-con-uuid',
      nome: 'Clínica Conectada',
      telefoneWpp: '5511988887777',
    };

    prisma.clinica.count.mockResolvedValue(1);
    prisma.agendamento.count.mockResolvedValue(0);
    prisma.clinica.findMany.mockResolvedValueOnce([clinicaConectada]);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    checkRedisConnection.mockResolvedValueOnce(true);

    getInstanceStatus.mockResolvedValueOnce({ instance: { state: 'open' } });

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.alertas).toHaveLength(0);
  });

  it('reporta db=true quando $queryRaw resolve com sucesso', async () => {
    prisma.clinica.count.mockResolvedValue(0);
    prisma.agendamento.count.mockResolvedValue(0);
    prisma.clinica.findMany.mockResolvedValueOnce([]);
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]); // db ok

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.infraestrutura.db).toBe(true);
  });

  it('reporta db=false quando $queryRaw rejeita (banco inacessível)', async () => {
    prisma.clinica.count.mockResolvedValue(0);
    prisma.agendamento.count.mockResolvedValue(0);
    prisma.clinica.findMany.mockResolvedValueOnce([]);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused')); // db falhou

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.infraestrutura.db).toBe(false);
  });

  it('não trava quando instância WhatsApp lança erro (Promise.allSettled)', async () => {
    const clinicaComErro = {
      id: 'clinica-err-uuid',
      nome: 'Clínica Com Erro',
      telefoneWpp: '5511977776666',
    };

    prisma.clinica.count.mockResolvedValue(1);
    prisma.agendamento.count.mockResolvedValue(0);
    prisma.clinica.findMany.mockResolvedValueOnce([clinicaComErro]);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    checkRedisConnection.mockResolvedValueOnce(true);

    // Instância lança erro — não deve travar o endpoint
    getInstanceStatus.mockRejectedValueOnce(new Error('Evolution API timeout'));

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    // Deve retornar 200 mesmo com falha na instância
    expect(res.statusCode).toBe(200);
    // Erro no allSettled gera status 'rejected' — não vira alerta (apenas clínicas
    // com status resolvido e diferente de 'open' viram alerta)
    expect(JSON.parse(res.body).data.alertas).toHaveLength(0);
  });

  it('retorna 401 sem token de autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
    });

    expect(res.statusCode).toBe(401);
  });
});
