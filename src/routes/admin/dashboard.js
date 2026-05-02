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

    // Janela de "próximos agendamentos" — 7 dias à frente. O frontend filtra
    // entre Hoje / Amanhã / Próximos 7 dias usando esses dados; uma única query
    // serve às 3 abas, o que evita refetch ao trocar o filtro.
    const proximosLimit = new Date(agora.getTime() + 7 * 86400000);

    // Últimos 30 dias para taxa de confirmação e mix particular/convênio
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

      // Agendamentos da semana corrente — agregamos no JS por dia (gráfico)
      // e por profissional (top profissionais).
      prisma.agendamento.findMany({
        where: {
          clinicaId,
          dataHora: { gte: inicioSemana, lt: fimSemana },
          status: { notIn: ['cancelado', 'no_show'] },
        },
        select: {
          dataHora: true,
          profissional: { select: { id: true, nome: true, especialidade: true } },
        },
      }),

      // Últimos 30 dias — usado para taxa de confirmação E mix particular/convênio
      prisma.agendamento.findMany({
        where: { clinicaId, dataHora: { gte: inicio30Dias } },
        select: {
          status: true,
          tipoConsulta: true,
          convenio: { select: { nome: true } },
        },
      }),

      // Próximos 7 dias (até 50) — frontend filtra para Hoje/Amanhã/7 dias
      prisma.agendamento.findMany({
        where: {
          clinicaId,
          dataHora: { gte: agora, lte: proximosLimit },
          status: { in: ['agendado', 'confirmado'] },
        },
        orderBy: { dataHora: 'asc' },
        take: 50,
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

    // ── Mix particular vs convênio (30 dias, exclui cancelado/no-show) ──
    const agendamentosValidos30 = agendamentos30Dias.filter(
      (a) => !['cancelado', 'no_show'].includes(a.status),
    );
    const conveniosCount = {};
    let particularCount = 0;
    for (const a of agendamentosValidos30) {
      if (a.tipoConsulta === 'convenio' && a.convenio?.nome) {
        conveniosCount[a.convenio.nome] = (conveniosCount[a.convenio.nome] ?? 0) + 1;
      } else {
        particularCount += 1;
      }
    }
    const conveniosArr = Object.entries(conveniosCount)
      .map(([nome, count]) => ({ nome, count }))
      .sort((a, b) => b.count - a.count);
    const totalMix = particularCount + conveniosArr.reduce((s, c) => s + c.count, 0);
    const mixConsulta = {
      total: totalMix,
      particular: particularCount,
      convenios: conveniosArr,
    };

    // ── Top profissionais da semana corrente ──
    const profPorContagem = new Map();
    for (const a of agendamentosSemanaRaw) {
      if (!a.profissional) continue;
      const id = a.profissional.id;
      const existing = profPorContagem.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        profPorContagem.set(id, {
          id,
          nome: a.profissional.nome,
          especialidade: a.profissional.especialidade,
          count: 1,
        });
      }
    }
    const topProfissionais = Array.from(profPorContagem.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

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
        topProfissionais,

        // 30 dias
        taxaConfirmacao,
        mixConsulta,

        // Saúde do bot
        botHoje: {
          conversas: conversasHoje,
          agendamentosCriados: agendamentosCriadosHoje,
        },

        // Lista (próximos 7 dias — frontend filtra por aba)
        proximosAgendamentos,
      },
    });
  });
}
