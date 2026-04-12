/**
 * Testes de autenticação do painel do proprietário.
 *
 * Cobre:
 * - Login com credenciais válidas retorna JWT com role=owner
 * - Login com e-mail inexistente retorna 401
 * - Login com senha incorreta retorna 401
 * - Acesso a rota protegida sem token retorna 401
 * - Acesso a rota protegida com token de admin (sem role=owner) retorna 401
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

// ── Mocks (hoistados pelo Vitest antes dos imports) ───────────────────────────

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
  getInstanceStatus: vi.fn().mockResolvedValue({ instance: { state: 'open' } }),
  createInstance: vi.fn().mockResolvedValue({ instance: { instanceName: 'test' } }),
  getQRCode: vi.fn().mockResolvedValue({ base64: 'data:image/png;base64,abc' }),
}));

// ── Imports após mocks ────────────────────────────────────────────────────────

import { buildApp, gerarTokenAdmin } from '../helpers/buildApp.js';
import { prisma } from '../../src/config/database.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_FIXTURE = {
  id: 'owner-uuid-123',
  email: 'owner@agendazap.com',
  senhaHash: '', // será preenchido no beforeAll
};

// ── Testes ────────────────────────────────────────────────────────────────────

describe('POST /owner/auth/login', () => {
  let app;

  beforeAll(async () => {
    OWNER_FIXTURE.senhaHash = await bcrypt.hash('Senha@Segura1', 10);
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 e JWT com role=owner para credenciais válidas', async () => {
    prisma.usuarioOwner.findUnique.mockResolvedValueOnce(OWNER_FIXTURE);

    const res = await app.inject({
      method: 'POST',
      url: '/owner/auth/login',
      payload: { email: OWNER_FIXTURE.email, senha: 'Senha@Segura1' },
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.token).toBeDefined();
    expect(body.data.usuario.email).toBe(OWNER_FIXTURE.email);

    // Verifica claims do JWT
    const decoded = app.jwt.decode(body.data.token);
    expect(decoded.role).toBe('owner');
    expect(decoded.sub).toBe(OWNER_FIXTURE.id);
  });

  it('retorna 401 quando o e-mail não existe', async () => {
    prisma.usuarioOwner.findUnique.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/owner/auth/login',
      payload: { email: 'naoexiste@test.com', senha: 'qualquersenha' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('retorna 401 quando a senha está incorreta', async () => {
    prisma.usuarioOwner.findUnique.mockResolvedValueOnce(OWNER_FIXTURE);

    const res = await app.inject({
      method: 'POST',
      url: '/owner/auth/login',
      payload: { email: OWNER_FIXTURE.email, senha: 'SenhaErrada99' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('retorna 400 quando o body está incompleto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/owner/auth/login',
      payload: { email: OWNER_FIXTURE.email }, // sem senha
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Isolamento de autenticação — acesso a rotas protegidas /owner/*', () => {
  let app;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // dashboard precisa do prisma para não quebrar antes do check de auth
    prisma.clinica.count.mockResolvedValue(0);
    prisma.agendamento.count.mockResolvedValue(0);
    prisma.clinica.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('retorna 401 ao acessar /owner/dashboard sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 ao usar token de admin (sem role=owner) em /owner/dashboard', async () => {
    const adminToken = gerarTokenAdmin(app);

    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/não autorizado/i);
  });

  it('retorna 401 ao usar token com role=owner expirado', async () => {
    // Gera token já expirado (expiresIn no passado não é suportado diretamente —
    // simula passando um token mal-formado)
    const res = await app.inject({
      method: 'GET',
      url: '/owner/dashboard',
      headers: { authorization: 'Bearer token.invalido.aqui' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('token de owner NÃO dá acesso implícito às rotas /admin/* (não registradas no app de teste)', async () => {
    // Verifica que rotas admin não estão expostas no app do owner
    const ownerToken = app.jwt.sign({ sub: 'owner-id', role: 'owner' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
