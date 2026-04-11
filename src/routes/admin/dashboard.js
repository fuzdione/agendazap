import { prisma } from '../../config/database.js';

/**
 * Rota do painel administrativo — métricas e resumo da clínica.
 */
export async function dashboardRoutes(fastify) {
  fastify.get('/admin/dashboard', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;

    const agora = new Date();

    // Limites do dia atual em UTC (sem ajuste de fuso — comparações são feitas contra dataHora do banco)
    const inicioDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0);
    const fimDia    = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59);

    // Semana corrente (dom→sab)
    const diaSemana  = agora.getDay();
    const inicioSemana = new Date(inicioDia.getTime() - diaSemana * 86400000);
    const fimSemana    = new Date(inicioSemana.getTime() + 7 * 86400000);

    // Últimos 30 dias para taxa de confirmação
    const inicio30Dias = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalHoje, totalSemana, agendamentos30Dias, proximosAgendamentos] = await Promise.all([
      // Total de agendamentos hoje (exceto cancelados e no-show)
      prisma.agendamento.count({
        where: {
          clinicaId,
          dataHora: { gte: inicioDia, lte: fimDia },
          status: { notIn: ['cancelado', 'no_show'] },
        },
      }),

      // Total de agendamentos da semana (exceto cancelados e no-show)
      prisma.agendamento.count({
        where: {
          clinicaId,
          dataHora: { gte: inicioSemana, lt: fimSemana },
          status: { notIn: ['cancelado', 'no_show'] },
        },
      }),

      // Agendamentos dos últimos 30 dias para calcular taxa de confirmação
      prisma.agendamento.findMany({
        where: {
          clinicaId,
          dataHora: { gte: inicio30Dias },
        },
        select: { status: true },
      }),

      // Próximos 5 agendamentos a partir de agora
      prisma.agendamento.findMany({
        where: {
          clinicaId,
          dataHora: { gte: agora },
          status: { in: ['confirmado'] },
        },
        orderBy: { dataHora: 'asc' },
        take: 5,
        include: {
          paciente: { select: { nome: true, telefone: true } },
          profissional: { select: { nome: true, especialidade: true } },
        },
      }),
    ]);

    // Taxa de confirmação: (confirmados + concluídos) / total dos últimos 30 dias
    const total30 = agendamentos30Dias.length;
    const confirmados30 = agendamentos30Dias.filter(
      (a) => a.status === 'confirmado' || a.status === 'concluido',
    ).length;
    const taxaConfirmacao = total30 > 0 ? Math.round((confirmados30 / total30) * 100) : 0;

    return reply.send({
      success: true,
      data: {
        agendamentosHoje: totalHoje,
        agendamentosSemana: totalSemana,
        taxaConfirmacao,
        proximosAgendamentos,
      },
    });
  });
}
