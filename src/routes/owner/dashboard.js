import { prisma } from '../../config/database.js';
import { checkRedisConnection } from '../../config/redis.js';
import { getInstanceStatus } from '../../services/whatsappService.js';
import { env } from '../../config/env.js';

/**
 * Rota de dashboard do proprietário da solução.
 * Exibe métricas globais de todas as clínicas e status da infraestrutura.
 */
export async function ownerDashboardRoutes(fastify) {
  fastify.get('/owner/dashboard', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const agora = new Date();

    const inicioDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0);
    const fimDia    = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59);

    const diaSemana   = agora.getDay();
    const inicioSemana = new Date(inicioDia.getTime() - diaSemana * 86400000);
    const fimSemana    = new Date(inicioSemana.getTime() + 7 * 86400000);

    const [clinicasAtivas, clinicasInativas, agendamentosHoje, agendamentosSemana, clinicasParaAlerta] =
      await Promise.all([
        prisma.clinica.count({ where: { ativo: true } }),
        prisma.clinica.count({ where: { ativo: false } }),
        prisma.agendamento.count({
          where: {
            dataHora: { gte: inicioDia, lte: fimDia },
            status: { notIn: ['cancelado', 'no_show'] },
          },
        }),
        prisma.agendamento.count({
          where: {
            dataHora: { gte: inicioSemana, lt: fimSemana },
            status: { notIn: ['cancelado', 'no_show'] },
          },
        }),
        prisma.clinica.findMany({
          where: { ativo: true },
          select: { id: true, nome: true, telefoneWpp: true },
        }),
      ]);

    // Verifica saúde da infraestrutura
    const infraestrutura = { db: false, redis: false, evolutionApi: false };

    try {
      await prisma.$queryRaw`SELECT 1`;
      infraestrutura.db = true;
    } catch {
      // silencia — já logado no health check
    }

    try {
      infraestrutura.redis = await checkRedisConnection();
    } catch {
      // silencia
    }

    try {
      const evoUrl = `${env.EVOLUTION_API_URL}/instance/fetchInstances`;
      const res = await fetch(evoUrl, {
        headers: { apikey: env.EVOLUTION_API_KEY },
        signal: AbortSignal.timeout(5000),
      });
      infraestrutura.evolutionApi = res.ok;
    } catch {
      // silencia — evolutionApi permanece false
    }

    // Verifica status WhatsApp de cada clínica ativa (paralelo, não trava se uma falhar)
    const statusResults = await Promise.allSettled(
      clinicasParaAlerta.map(async (clinica) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const data = await getInstanceStatus(clinica.telefoneWpp);
          return { clinica, status: data?.instance?.state ?? data?.state ?? 'unknown' };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    const alertas = [];
    for (const result of statusResults) {
      if (result.status === 'fulfilled') {
        const { clinica, status } = result.value;
        if (status !== 'open') {
          alertas.push({
            tipo: 'whatsapp_desconectado',
            clinica: clinica.nome,
            clinicaId: clinica.id,
          });
        }
      }
    }

    return reply.send({
      success: true,
      data: {
        clinicasAtivas,
        clinicasInativas,
        agendamentosHoje,
        agendamentosSemana,
        infraestrutura,
        alertas,
      },
    });
  });
}
