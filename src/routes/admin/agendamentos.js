import { prisma } from '../../config/database.js';
import { deleteEvent, patchEventTitle } from '../../services/calendarService.js';
import { remindersQueue } from '../../config/queues.js';

/**
 * Rotas administrativas para gerenciamento de agendamentos.
 * Todas protegidas por JWT; clinicaId vem sempre do token — nunca do body/query.
 */
export async function agendamentosAdminRoutes(fastify) {
  /**
   * Lista agendamentos com filtros opcionais.
   * Query params: data_inicio, data_fim, profissional_id, status, page, limit
   */
  fastify.get('/admin/agendamentos', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          data_inicio:     { type: 'string' },
          data_fim:        { type: 'string' },
          profissional_id: { type: 'string' },
          status:          { type: 'string', enum: ['agendado', 'confirmado', 'cancelado', 'concluido', 'no_show'] },
          page:            { type: 'integer', minimum: 1, default: 1 },
          limit:           { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          ordem:           { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          busca:           { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;
    const { data_inicio, data_fim, profissional_id, status, page = 1, limit = 20, ordem = 'asc', busca } = request.query;

    const where = { clinicaId };

    // Datas vêm como YYYY-MM-DD do frontend. Interpretamos como dia local BRT
    // (UTC-3, fixo desde 2019) para evitar bug do parse default que usa UTC
    // e descartaria consultas da tarde do dia escolhido como data_fim.
    if (data_inicio || data_fim) {
      where.dataHora = {};
      if (data_inicio) where.dataHora.gte = new Date(`${data_inicio}T00:00:00-03:00`);
      if (data_fim)    where.dataHora.lte = new Date(`${data_fim}T23:59:59.999-03:00`);
    }

    if (profissional_id) where.profissionalId = profissional_id;
    if (status)          where.status = status;

    // Busca por nome (case-insensitive) ou telefone (só dígitos) do paciente.
    // O OR fica entre parêntese — combina com os demais filtros via AND.
    if (busca) {
      const termo = busca.trim();
      if (termo.length > 0) {
        const apenasDigitos = termo.replace(/\D/g, '');
        const orConditions = [
          { paciente: { nome: { contains: termo, mode: 'insensitive' } } },
        ];
        if (apenasDigitos.length > 0) {
          orConditions.push({ paciente: { telefone: { contains: apenasDigitos } } });
        }
        where.OR = orConditions;
      }
    }

    const [total, agendamentos] = await Promise.all([
      prisma.agendamento.count({ where }),
      prisma.agendamento.findMany({
        where,
        orderBy: { dataHora: ordem },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          paciente:    { select: { nome: true, telefone: true, email: true } },
          profissional: { select: { nome: true, especialidade: true } },
          convenio:    { select: { id: true, nome: true } },
        },
      }),
    ]);

    return reply.send({
      success: true,
      data: {
        agendamentos,
        paginacao: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  });

  /**
   * Atualiza o status de um agendamento.
   * Se cancelar: remove evento do Google Calendar e cancela lembrete no BullMQ.
   */
  fastify.put('/admin/agendamentos/:id/status', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['agendado', 'confirmado', 'cancelado', 'concluido', 'no_show'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;
    const clinicaId = request.user.clinicaId;

    const agendamento = await prisma.agendamento.findFirst({
      where: { id, clinicaId },
    });

    if (!agendamento) {
      return reply.status(404).send({ success: false, error: 'Agendamento não encontrado' });
    }

    // Ao confirmar manualmente: registra origem e atualiza título no Google Calendar
    if (status === 'confirmado' && agendamento.calendarEventId) {
      const paciente = await prisma.paciente.findUnique({
        where: { id: agendamento.pacienteId },
        select: { nome: true },
      });
      await patchEventTitle(
        clinicaId,
        agendamento.profissionalId,
        agendamento.calendarEventId,
        `✅ Confirmado pelo admin: ${paciente?.nome ?? 'Paciente'}`
      );
    }

    // Ao cancelar: limpa evento do Calendar e job de lembrete
    if (status === 'cancelado') {
      if (agendamento.calendarEventId) {
        try {
          await deleteEvent(clinicaId, agendamento.profissionalId, agendamento.calendarEventId);
        } catch (err) {
          request.log.warn({ msg: 'Falha ao remover evento do Calendar', error: err.message });
        }
      }

      if (agendamento.reminderJobId) {
        try {
          const job = await remindersQueue.getJob(agendamento.reminderJobId);
          if (job) await job.remove();
        } catch (err) {
          request.log.warn({ msg: 'Falha ao cancelar job de lembrete', error: err.message });
        }
      }
    }

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: { status, ...(status === 'confirmado' ? { confirmedBy: 'admin' } : {}) },
      include: {
        paciente:    { select: { nome: true, telefone: true } },
        profissional: { select: { nome: true, especialidade: true } },
        convenio:    { select: { id: true, nome: true } },
      },
    });

    return reply.send({ success: true, data: atualizado });
  });
}
