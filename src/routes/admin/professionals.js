import { prisma } from '../../config/database.js';
import { listCalendars } from '../../services/calendarService.js';

/**
 * Rotas administrativas para gerenciar profissionais e vincular Google Calendars.
 */
export async function professionalsRoutes(fastify) {
  /**
   * Lista os calendários disponíveis na conta Google conectada à clínica.
   * O admin usa esta lista para escolher qual calendar associar a cada profissional.
   */
  fastify.get('/admin/calendars/:clinicaId', async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    try {
      const calendars = await listCalendars(clinicaId);
      return reply.send({ success: true, data: calendars });
    } catch (err) {
      if (err.code === 'GOOGLE_NOT_AUTHORIZED') {
        return reply.status(400).send({
          success: false,
          error: 'Google Calendar não autorizado para esta clínica. Acesse /admin/google/auth/:clinicaId para autorizar.',
        });
      }
      request.log.error({ msg: 'Erro ao listar calendars', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * Associa um Google Calendar ID a um profissional.
   * Deve ser chamado após o admin listar os calendars disponíveis e escolher o correto.
   */
  fastify.put('/admin/profissionais/:profissionalId/calendar', {
    schema: {
      body: {
        type: 'object',
        required: ['calendarId'],
        properties: {
          calendarId: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { profissionalId } = request.params;
    const { calendarId } = request.body;

    const profissional = await prisma.profissional.findUnique({
      where: { id: profissionalId },
    });

    if (!profissional) {
      return reply.status(404).send({ success: false, error: 'Profissional não encontrado' });
    }

    const atualizado = await prisma.profissional.update({
      where: { id: profissionalId },
      data: { calendarId },
    });

    return reply.send({ success: true, data: atualizado });
  });
}
