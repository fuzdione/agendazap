import { prisma } from '../../config/database.js';

/**
 * Rota de histórico de conversas para o painel administrativo.
 */
export async function conversasAdminRoutes(fastify) {
  /**
   * Lista contatos únicos que já conversaram com o bot,
   * com a última mensagem e data de cada um.
   * Usado para montar a lista de contatos na página de Conversas.
   */
  fastify.get('/admin/conversas/contatos', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;

    // Busca a mensagem mais recente de cada telefone
    // clinicaId vem do JWT (confiável) — uso queryRawUnsafe para evitar o problema
    // de coerção text→uuid no PostgreSQL com parâmetros posicionais do Prisma.
    const contatos = await prisma.$queryRawUnsafe(`
      SELECT
        c.telefone,
        p.nome,
        MAX(c.created_at)                                          AS ultima_data,
        (array_agg(c.mensagem ORDER BY c.created_at DESC))[1]     AS ultima_mensagem,
        COUNT(*)::int                                              AS total
      FROM conversas c
      LEFT JOIN pacientes p ON p.id = c.paciente_id
      WHERE c.clinica_id = '${clinicaId}'
      GROUP BY c.telefone, p.nome
      ORDER BY ultima_data DESC
      LIMIT 100
    `);

    return reply.send({ success: true, data: contatos });
  });

  fastify.get('/admin/conversas', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          telefone:    { type: 'string' },
          data:        { type: 'string' },
          page:        { type: 'integer', minimum: 1, default: 1 },
          limit:       { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;
    const { telefone, data, page = 1, limit = 50 } = request.query;

    const where = { clinicaId };

    if (telefone) {
      // Aceita telefone com ou sem prefixo 55 para facilitar busca
      where.telefone = { contains: telefone.replace(/\D/g, '') };
    }

    if (data) {
      const inicio = new Date(data);
      const fim    = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
      where.createdAt = { gte: inicio, lt: fim };
    }

    const [total, conversas] = await Promise.all([
      prisma.conversa.count({ where }),
      // Ordena desc para pegar as N mais recentes, depois inverte para exibição cronológica
      prisma.conversa.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          telefone: true,
          direcao: true,
          mensagem: true,
          createdAt: true,
          paciente: { select: { nome: true } },
        },
      }).then((rows) => rows.reverse()),
    ]);

    return reply.send({
      success: true,
      data: {
        conversas,
        paginacao: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  });
}
