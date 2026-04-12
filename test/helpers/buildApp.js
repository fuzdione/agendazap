/**
 * Constrói uma instância Fastify mínima para testes das rotas owner.
 *
 * Não importa server.js — evita inicialização de Redis, BullMQ workers e
 * conexão real com banco. Os módulos externos são mockados por cada arquivo
 * de teste via vi.mock() (hoistado pelo Vitest antes dos imports).
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { authenticateOwner } from '../../src/middleware/authenticateOwner.js';
import { ownerAuthRoutes } from '../../src/routes/owner/auth.js';
import { ownerDashboardRoutes } from '../../src/routes/owner/dashboard.js';
import { ownerClinicasRoutes } from '../../src/routes/owner/clinicas.js';

export const TEST_JWT_SECRET = 'test-secret-minimum-16chars!!';

/**
 * Monta o app de teste com os plugins mínimos e as rotas owner registradas.
 * Sem @fastify/rate-limit — o config.rateLimit nas rotas é ignorado (metadata only).
 */
export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(jwt, { secret: TEST_JWT_SECRET });

  // Decorator para rotas admin (não usado nos testes owner, mas evita erros de
  // "decorator not found" caso algum plugin tente acessá-lo)
  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  app.decorate('authenticateOwner', authenticateOwner);

  await app.register(ownerAuthRoutes);
  await app.register(ownerDashboardRoutes);
  await app.register(ownerClinicasRoutes);

  await app.ready();
  return app;
}

/**
 * Gera um JWT de proprietário válido para usar nos testes de rotas protegidas.
 */
export function gerarTokenOwner(app, id = 'owner-test-uuid') {
  return app.jwt.sign({ sub: id, role: 'owner' });
}

/**
 * Gera um JWT de admin de clínica (sem role="owner") para testar isolamento.
 */
export function gerarTokenAdmin(app, clinicaId = 'clinica-test-uuid') {
  return app.jwt.sign({ sub: 'admin-test-uuid', clinicaId });
}
