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

    // Limites do dia atual em horário local
    const inicioDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0);
    const fimDia    = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59);

    // Semana corrente (dom→sab)
    const diaSemana  = agora.getDay();
    const inicioSemana = new Date(inicioDia.getTime() - diaSemana * 86400000);
    const fimSemana    = new Date(inicioSemana.getTime() + 7 * 86400000);

    // Próximas 2 horas — usado para destacar "vai chegar paciente"
    const proximas2hLimit = new Date(agora.getTime() + 2 * 3600 * 1000);

    // Últimos 30 dias para taxa de confirmação
    const inicio30Dias = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      agendamentosHojeRaw,
      proximas2hCount,
      agendamentosSemanaRaw,
      agendamentos30Dias,
      proximosAgendamentos,
      conversasEntradaHoje,
      agendamentosCriadosHoje,
    ] = await Promise.all([
      // Todos os agendamentos de hoje (com status para breakdown)
      prisma.agendamento.findMany({
        where: { clinicaId, dataHora: { gte: inicioDia, lte: fimDia } },
        select: { status: true },
      }),

      // Próximas 2h — confirmados/agendados que precisam de atenção
      prisma.agendamento.count({
        where: {
          clinicaId,
          dataHora: { gte: agora, lte: proximas2hLimit },
          status: { in: ['agendado', 'confirmado'] },
        },
      }),

      // Agendamentos da semana corrente — dataHora para agregar por dia no JS
      prisma.agendamento.findMany({
        where: {
          clinicaId,
          dataHora: { gte: inicioSemana, lt: fimSemana },
          status: { notIn: ['cancelado', 'no_show'] },
        },
        select: { dataHora: true },
      }),

      // Agendamentos dos últimos 30 dias para taxa de confirmação
      prisma.agendamento.findMany({
        where: { clinicaId, dataHora: { gte: inicio30Dias } },
        select: { status: true },
      }),

      // Próximos 5 agendamentos a partir de agora
      prisma.agendamento.findMany({
        where: {
          clinicaId,
          dataHora: { gte: agora },
          status: { in: ['agendado', 'confirmado'] },
        },
        orderBy: { dataHora: 'asc' },
        take: 5,
        include: {
          paciente: { select: { nome: true, telefone: true } },
          profissional: { select: { nome: true, especialidade: true } },
        },
      }),

      // Conversas de entrada hoje — distinct por telefone via select
      prisma.conversa.findMany({
        where: {
          clinicaId,
          direcao: 'entrada',
          createdAt: { gte: inicioDia, lte: fimDia },
        },
        select: { telefone: true },
        distinct: ['telefone'],
      }),

      // Agendamentos criados hoje (createdAt, não dataHora)
      prisma.agendamento.count({
        where: { clinicaId, createdAt: { gte: inicioDia, lte: fimDia } },
      }),
    ]);

    // ── Breakdown de hoje por status ──
    const hojeBreakdown = {
      total: agendamentosHojeRaw.length,
      confirmado: agendamentosHojeRaw.filter((a) => a.status === 'confirmado').length,
      agendado:   agendamentosHojeRaw.filter((a) => a.status === 'agendado').length,
      concluido:  agendamentosHojeRaw.filter((a) => a.status === 'concluido').length,
      cancelado:  agendamentosHojeRaw.filter((a) => a.status === 'cancelado').length,
      noShow:     agendamentosHojeRaw.filter((a) => a.status === 'no_show').length,
    };
    // "Ativos hoje" = excluindo cancelados e no-show (mantém retrocompatibilidade do KPI antigo)
    const totalHoje = hojeBreakdown.total - hojeBreakdown.cancelado - hojeBreakdown.noShow;

    // ── Agregação por dia da semana corrente (para o mini gráfico) ──
    const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const agendamentosPorDia = Array.from({ length: 7 }, (_, i) => {
      const dataDia = new Date(inicioSemana.getTime() + i * 86400000);
      const dataIni = new Date(dataDia.getFullYear(), dataDia.getMonth(), dataDia.getDate(), 0, 0, 0);
      const dataFim = new Date(dataDia.getFullYear(), dataDia.getMonth(), dataDia.getDate(), 23, 59, 59);
      const count = agendamentosSemanaRaw.filter(
        (a) => a.dataHora >= dataIni && a.dataHora <= dataFim
      ).length;
      const isToday = dataDia.toDateString() === agora.toDateString();
      return {
        data: dataDia.toISOString().slice(0, 10),
        diaSemana: DIAS_SEMANA[i],
        count,
        isToday,
      };
    });
    const totalSemana = agendamentosSemanaRaw.length;

    // ── Taxa de confirmação 30 dias ──
    const total30 = agendamentos30Dias.length;
    const confirmados30 = agendamentos30Dias.filter(
      (a) => ['agendado', 'confirmado', 'concluido'].includes(a.status),
    ).length;
    const taxaConfirmacao = total30 > 0 ? Math.round((confirmados30 / total30) * 100) : 0;

    // ── Saúde do bot ──
    const conversasHoje = conversasEntradaHoje.length;

    return reply.send({
      success: true,
      data: {
        // Hoje detalhado
        agendamentosHoje: totalHoje,
        hojeBreakdown,
        proximas2h: proximas2hCount,

        // Semana
        agendamentosSemana: totalSemana,
        agendamentosPorDia,

        // 30 dias
        taxaConfirmacao,

        // Saúde do bot
        botHoje: {
          conversas: conversasHoje,
          agendamentosCriados: agendamentosCriadosHoje,
        },

        // Lista
        proximosAgendamentos,
      },
    });
  });
}
