import { prisma } from '../../config/database.js';

/**
 * CRUD de convênios para o painel administrativo.
 * Convênios são vinculados à clínica e associados a profissionais.
 */
export async function conveniosRoutes(fastify) {
  /**
   * Lista convênios da clínica.
   */
  fastify.get('/admin/convenios', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;

    const convenios = await prisma.convenio.findMany({
      where: { clinicaId },
      orderBy: { nome: 'asc' },
      include: {
        profissionais: {
          include: {
            profissional: { select: { id: true, nome: true, especialidade: true } },
          },
        },
      },
    });

    return reply.send({ success: true, data: convenios });
  });

  /**
   * Cria um novo convênio.
   */
  fastify.post('/admin/convenios', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome: { type: 'string', minLength: 1, maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;
    const { nome } = request.body;

    const nomeNormalizado = nome.trim();

    const existe = await prisma.convenio.findUnique({
      where: { clinicaId_nome: { clinicaId, nome: nomeNormalizado } },
    });

    if (existe) {
      return reply.status(409).send({ success: false, error: 'Convênio com este nome já existe' });
    }

    const convenio = await prisma.convenio.create({
      data: { clinicaId, nome: nomeNormalizado, ativo: true },
    });

    return reply.status(201).send({ success: true, data: convenio });
  });

  /**
   * Ativa ou desativa um convênio.
   */
  fastify.put('/admin/convenios/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          ativo: { type: 'boolean' },
          nome:  { type: 'string', minLength: 1, maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const clinicaId = request.user.clinicaId;

    const convenio = await prisma.convenio.findFirst({ where: { id, clinicaId } });

    if (!convenio) {
      return reply.status(404).send({ success: false, error: 'Convênio não encontrado' });
    }

    const atualizado = await prisma.convenio.update({
      where: { id },
      data: request.body,
    });

    return reply.send({ success: true, data: atualizado });
  });

  /**
   * Remove um convênio (hard delete — só permitido se não há agendamentos vinculados).
   */
  fastify.delete('/admin/convenios/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const clinicaId = request.user.clinicaId;

    const convenio = await prisma.convenio.findFirst({ where: { id, clinicaId } });

    if (!convenio) {
      return reply.status(404).send({ success: false, error: 'Convênio não encontrado' });
    }

    const agendamentosVinculados = await prisma.agendamento.count({ where: { convenioId: id } });
    if (agendamentosVinculados > 0) {
      // Apenas desativa em vez de remover para preservar histórico
      await prisma.convenio.update({ where: { id }, data: { ativo: false } });
      return reply.send({ success: true, data: { message: 'Convênio desativado (possui agendamentos vinculados)' } });
    }

    await prisma.convenio.delete({ where: { id } });
    return reply.send({ success: true, data: { message: 'Convênio removido com sucesso' } });
  });

  /**
   * Vincula/desvincula convênios de um profissional.
   * Body: { convenioIds: string[] } — lista completa dos convênios que o profissional deve ter.
   */
  fastify.put('/admin/profissionais/:id/convenios', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['convenioIds'],
        properties: {
          convenioIds: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id: profissionalId } = request.params;
    const clinicaId = request.user.clinicaId;
    const { convenioIds } = request.body;

    const profissional = await prisma.profissional.findFirst({ where: { id: profissionalId, clinicaId } });
    if (!profissional) {
      return reply.status(404).send({ success: false, error: 'Profissional não encontrado' });
    }

    // Valida que todos os convênios pertencem à clínica
    if (convenioIds.length > 0) {
      const conveniosValidos = await prisma.convenio.count({
        where: { id: { in: convenioIds }, clinicaId },
      });
      if (conveniosValidos !== convenioIds.length) {
        return reply.status(400).send({ success: false, error: 'Um ou mais convênios inválidos' });
      }
    }

    // Substitui todos os vínculos existentes
    await prisma.profissionalConvenio.deleteMany({ where: { profissionalId } });

    if (convenioIds.length > 0) {
      await prisma.profissionalConvenio.createMany({
        data: convenioIds.map((convenioId) => ({ profissionalId, convenioId })),
      });
    }

    return reply.send({ success: true, data: { message: 'Convênios atualizados com sucesso' } });
  });
}
