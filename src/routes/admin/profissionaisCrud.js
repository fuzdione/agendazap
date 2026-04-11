import { prisma } from '../../config/database.js';

/**
 * CRUD de profissionais para o painel administrativo.
 * Não duplica as rotas de calendar que já existem em professionals.js.
 */
export async function profissionaisCrudRoutes(fastify) {
  /**
   * Lista profissionais da clínica (ativos e inativos).
   */
  fastify.get('/admin/profissionais', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ativo: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;
    const where = { clinicaId };

    // Se o filtro 'ativo' for enviado explicitamente, aplica; senão retorna todos
    if (request.query.ativo !== undefined) {
      where.ativo = request.query.ativo;
    }

    const profissionais = await prisma.profissional.findMany({
      where,
      orderBy: { nome: 'asc' },
    });

    return reply.send({ success: true, data: profissionais });
  });

  /**
   * Cria um novo profissional.
   */
  fastify.post('/admin/profissionais', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'especialidade'],
        properties: {
          nome:                { type: 'string', minLength: 1 },
          especialidade:       { type: 'string', minLength: 1 },
          duracaoConsultaMin:  { type: 'integer', minimum: 5, default: 30 },
        },
      },
    },
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;
    const { nome, especialidade, duracaoConsultaMin = 30 } = request.body;

    const profissional = await prisma.profissional.create({
      data: { clinicaId, nome, especialidade, duracaoConsultaMin, ativo: true },
    });

    return reply.status(201).send({ success: true, data: profissional });
  });

  /**
   * Atualiza dados de um profissional (nome, especialidade, duração, ativo).
   */
  fastify.put('/admin/profissionais/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          nome:               { type: 'string', minLength: 1 },
          especialidade:      { type: 'string', minLength: 1 },
          duracaoConsultaMin: { type: 'integer', minimum: 5 },
          ativo:              { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const clinicaId = request.user.clinicaId;

    const profissional = await prisma.profissional.findFirst({
      where: { id, clinicaId },
    });

    if (!profissional) {
      return reply.status(404).send({ success: false, error: 'Profissional não encontrado' });
    }

    const atualizado = await prisma.profissional.update({
      where: { id },
      data: request.body,
    });

    return reply.send({ success: true, data: atualizado });
  });

  /**
   * Desativa um profissional (soft delete — preserva histórico de agendamentos).
   */
  fastify.delete('/admin/profissionais/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const clinicaId = request.user.clinicaId;

    const profissional = await prisma.profissional.findFirst({
      where: { id, clinicaId },
    });

    if (!profissional) {
      return reply.status(404).send({ success: false, error: 'Profissional não encontrado' });
    }

    await prisma.profissional.update({
      where: { id },
      data: { ativo: false },
    });

    return reply.send({ success: true, data: { message: 'Profissional desativado com sucesso' } });
  });
}
