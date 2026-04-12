/**
 * Testes de CRUD de clínicas via painel do proprietário.
 *
 * Cobre:
 * - Criar clínica com dados válidos retorna 201
 * - Criar com telefone duplicado retorna 409
 * - Criar com e-mail de admin duplicado retorna 409
 * - Criar com telefone inválido retorna 422
 * - Toggle ativo/inativo alterna o campo e retorna 200
 * - Reset de senha retorna nova senha (10 chars) e atualiza hash no banco
 * - GET /owner/clinicas lista com paginação
 * - GET /owner/clinicas/:id retorna 404 para id inexistente
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

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
  getInstanceStatus: vi.fn().mockResolvedValue({ instance: { state: 'open' } }),
  createInstance: vi.fn(),
  getQRCode: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { buildApp, gerarTokenOwner } from '../helpers/buildApp.js';
import { prisma } from '../../src/config/database.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLINICA_FIXTURE = {
  id: 'clinica-uuid-123',
  nome: 'Clínica Teste',
  telefoneWpp: '5511987654321',
  endereco: 'Rua Teste, 123',
  ativo: true,
  createdAt: new Date('2025-01-01'),
  configJson: {},
  googleRefreshToken: null,
  profissionais: [],
  _count: { pacientes: 5 },
};

// ── Helpers de setup ─────────────────────────────────────────────────────────

function mockClinicaInexistente() {
  prisma.clinica.findUnique.mockResolvedValueOnce(null);
}

function mockClinicaExistente(overrides = {}) {
  prisma.clinica.findUnique.mockResolvedValueOnce({ ...CLINICA_FIXTURE, ...overrides });
}

// ── Suite: POST /owner/clinicas ───────────────────────────────────────────────

describe('POST /owner/clinicas', () => {
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
  });

  const payloadValido = {
    nome: 'Clínica Nova',
    telefoneWpp: '5511987654321',
    adminEmail: 'admin@clinicanova.com',
    adminSenha: 'Senha123',
  };

  it('retorna 201 e dados da clínica criada (sem senha)', async () => {
    prisma.clinica.findUnique.mockResolvedValueOnce(null); // telefone livre
    prisma.usuarioAdmin.findUnique.mockResolvedValueOnce(null); // email livre

    prisma.$transaction.mockImplementationOnce(async (fn) => {
      return fn({
        clinica: {
          create: vi.fn().mockResolvedValueOnce({
            id: 'nova-clinica-uuid',
            nome: payloadValido.nome,
            telefoneWpp: payloadValido.telefoneWpp,
            ativo: true,
          }),
        },
        usuarioAdmin: {
          create: vi.fn().mockResolvedValueOnce({
            id: 'novo-admin-uuid',
            email: payloadValido.adminEmail,
            clinicaId: 'nova-clinica-uuid',
          }),
        },
      });
    });

    const res = await app.inject({
      method: 'POST',
      url: '/owner/clinicas',
      headers: { authorization: `Bearer ${token}` },
      payload: payloadValido,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.clinica.nome).toBe(payloadValido.nome);
    expect(body.data.admin.email).toBe(payloadValido.adminEmail);
    // Nunca retorna a senha
    expect(body.data.admin.senha).toBeUndefined();
    expect(body.data.admin.senhaHash).toBeUndefined();
  });

  it('retorna 409 quando o telefone já está cadastrado em outra clínica', async () => {
    prisma.clinica.findUnique.mockResolvedValueOnce(CLINICA_FIXTURE); // telefone ocupado
    prisma.usuarioAdmin.findUnique.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/owner/clinicas',
      headers: { authorization: `Bearer ${token}` },
      payload: payloadValido,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/telefone/i);
  });

  it('retorna 409 quando o e-mail do admin já está em uso', async () => {
    prisma.clinica.findUnique.mockResolvedValueOnce(null); // telefone livre
    prisma.usuarioAdmin.findUnique.mockResolvedValueOnce({ id: 'outro-admin' }); // email ocupado

    const res = await app.inject({
      method: 'POST',
      url: '/owner/clinicas',
      headers: { authorization: `Bearer ${token}` },
      payload: payloadValido,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/e-mail/i);
  });

  it('retorna 422 para número de telefone inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/owner/clinicas',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payloadValido, telefoneWpp: '123' }, // número inválido
    });

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toMatch(/telefone/i);
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/owner/clinicas',
      payload: payloadValido,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Suite: PUT /owner/clinicas/:id/toggle ─────────────────────────────────────

describe('PUT /owner/clinicas/:id/toggle', () => {
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
  });

  it('desativa uma clínica ativa e retorna ativo=false', async () => {
    mockClinicaExistente({ ativo: true });
    prisma.clinica.update.mockResolvedValueOnce({
      id: CLINICA_FIXTURE.id,
      nome: CLINICA_FIXTURE.nome,
      ativo: false,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/owner/clinicas/${CLINICA_FIXTURE.id}/toggle`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.ativo).toBe(false);

    // Verifica que update foi chamado com ativo: false (negação de true)
    expect(prisma.clinica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CLINICA_FIXTURE.id },
        data: { ativo: false },
      }),
    );
  });

  it('ativa uma clínica inativa e retorna ativo=true', async () => {
    mockClinicaExistente({ ativo: false });
    prisma.clinica.update.mockResolvedValueOnce({
      id: CLINICA_FIXTURE.id,
      nome: CLINICA_FIXTURE.nome,
      ativo: true,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/owner/clinicas/${CLINICA_FIXTURE.id}/toggle`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.ativo).toBe(true);
  });

  it('retorna 404 para clínica inexistente', async () => {
    mockClinicaInexistente();

    const res = await app.inject({
      method: 'PUT',
      url: '/owner/clinicas/id-inexistente/toggle',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── Suite: POST /owner/clinicas/:id/reset-senha ───────────────────────────────

describe('POST /owner/clinicas/:id/reset-senha', () => {
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
  });

  it('retorna nova senha com 10 caracteres e atualiza o hash no banco', async () => {
    const adminMock = {
      id: 'admin-uuid',
      email: 'admin@clinica.com',
      clinicaId: CLINICA_FIXTURE.id,
    };
    prisma.usuarioAdmin.findFirst.mockResolvedValueOnce(adminMock);
    prisma.usuarioAdmin.update.mockResolvedValueOnce({ ...adminMock });

    const res = await app.inject({
      method: 'POST',
      url: `/owner/clinicas/${CLINICA_FIXTURE.id}/reset-senha`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.novaSenha).toBeDefined();
    expect(body.data.novaSenha).toHaveLength(10);

    // Verifica que update foi chamado com um hash (não a senha em texto claro)
    const updateCall = prisma.usuarioAdmin.update.mock.calls[0][0];
    const hashSalvo = updateCall.data.senhaHash;
    expect(hashSalvo).toBeDefined();
    expect(hashSalvo).not.toBe(body.data.novaSenha); // nunca salva senha em texto
    // Confirma que o hash bate com a nova senha retornada
    const senhaValida = await bcrypt.compare(body.data.novaSenha, hashSalvo);
    expect(senhaValida).toBe(true);
  });

  it('retorna 404 quando não há admin cadastrado para a clínica', async () => {
    prisma.usuarioAdmin.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: `/owner/clinicas/clinica-sem-admin/reset-senha`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── Suite: GET /owner/clinicas ────────────────────────────────────────────────

describe('GET /owner/clinicas', () => {
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
  });

  it('retorna lista paginada de clínicas', async () => {
    prisma.clinica.count.mockResolvedValueOnce(1);
    prisma.clinica.findMany.mockResolvedValueOnce([
      {
        id: CLINICA_FIXTURE.id,
        nome: CLINICA_FIXTURE.nome,
        telefoneWpp: CLINICA_FIXTURE.telefoneWpp,
        endereco: CLINICA_FIXTURE.endereco,
        ativo: true,
        createdAt: CLINICA_FIXTURE.createdAt,
        _count: { agendamentos: 10, pacientes: 5 },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/owner/clinicas',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.clinicas).toHaveLength(1);
    expect(body.data.paginacao.total).toBe(1);
    expect(body.data.paginacao.page).toBe(1);
  });
});

// ── Suite: GET /owner/clinicas/:id ────────────────────────────────────────────

describe('GET /owner/clinicas/:id', () => {
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
  });

  it('retorna dados completos de uma clínica existente', async () => {
    prisma.clinica.findUnique.mockResolvedValueOnce({
      ...CLINICA_FIXTURE,
      profissionais: [
        {
          id: 'prof-uuid',
          nome: 'Dr. Teste',
          especialidade: 'Clínica Geral',
          duracaoConsultaMin: 30,
          calendarId: null,
          ativo: true,
        },
      ],
    });
    prisma.agendamento.count.mockResolvedValueOnce(8);

    const res = await app.inject({
      method: 'GET',
      url: `/owner/clinicas/${CLINICA_FIXTURE.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.nome).toBe(CLINICA_FIXTURE.nome);
    expect(body.data.profissionais).toHaveLength(1);
    expect(body.data.agendamentosMes).toBe(8);
    expect(body.data.googleCalendarConectado).toBe(false);
  });

  it('retorna 404 para id inexistente', async () => {
    prisma.clinica.findUnique.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/owner/clinicas/id-nao-existe',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
