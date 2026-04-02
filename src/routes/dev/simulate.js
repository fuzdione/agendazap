import { prisma } from '../../config/database.js';
import { handleIncomingMessage } from '../../services/conversationService.js';

/**
 * Rotas de simulação para testes sem WhatsApp real.
 * ATENÇÃO: Só disponíveis quando NODE_ENV=development.
 */
export async function devSimulateRoutes(fastify) {
  // Guard: bloqueia em produção
  fastify.addHook('onRequest', async (request, reply) => {
    if (process.env.NODE_ENV !== 'development') {
      return reply.status(404).send({ message: 'Not Found' });
    }
  });

  /**
   * POST /dev/simulate
   * Simula o recebimento de uma mensagem WhatsApp e retorna a resposta do bot.
   * Salva tudo no banco normalmente — sem enviar pelo WhatsApp.
   *
   * Body: { "phone": "5561999990002", "message": "Oi" }
   */
  fastify.post('/dev/simulate', async (request, reply) => {
    const { phone, message } = request.body ?? {};

    if (!phone || !message) {
      return reply.status(400).send({
        success: false,
        error: 'Campos obrigatórios: phone e message',
      });
    }

    // Normaliza telefone: remove @s.whatsapp.net se vier junto
    const telefone = phone.replace('@s.whatsapp.net', '').trim();

    // Encontra a primeira clínica ativa (em dev pode haver só uma)
    const clinica = await prisma.clinica.findFirst({ where: { ativo: true } });

    if (!clinica) {
      return reply.status(404).send({
        success: false,
        error: 'Nenhuma clínica ativa encontrada. Execute o seed: npx prisma db seed',
      });
    }

    // Busca ou cria o paciente
    let paciente = await prisma.paciente.findFirst({
      where: { clinicaId: clinica.id, telefone },
      orderBy: { createdAt: 'asc' },
    });

    if (!paciente) {
      paciente = await prisma.paciente.create({
        data: { clinicaId: clinica.id, telefone },
      });
    }

    // Salva mensagem de entrada (igual ao webhook real)
    await prisma.conversa.create({
      data: {
        clinicaId: clinica.id,
        pacienteId: paciente.id,
        telefone,
        direcao: 'entrada',
        mensagem: message,
      },
    });

    // Chama o orquestrador de conversa — mesma função do webhook real
    let resposta;
    try {
      resposta = await handleIncomingMessage(clinica.id, telefone, message, clinica);
    } catch (err) {
      request.log.error({ msg: '[Simulador] Erro no processamento pela IA', error: err.message });
      resposta = clinica.telefone
        ? `Desculpe, tive um probleminha técnico. Se preferir, ligue para ${clinica.telefone}.`
        : 'Desculpe, tive um probleminha técnico. Pode repetir sua mensagem? 🙏';
    }

    // Recarrega o paciente (conversationService pode ter atualizado o nome)
    const pacienteAtualizado = await prisma.paciente.findFirst({
      where: { clinicaId: clinica.id, telefone },
      orderBy: { createdAt: 'asc' },
    });

    // Salva resposta de saída (igual ao webhook real)
    await prisma.conversa.create({
      data: {
        clinicaId: clinica.id,
        pacienteId: (pacienteAtualizado ?? paciente).id,
        telefone,
        direcao: 'saida',
        mensagem: resposta,
      },
    });

    // Lê o estado atual da conversa para retornar no JSON
    const estadoAtual = await prisma.estadoConversa.findUnique({
      where: { telefone_clinicaId: { telefone, clinicaId: clinica.id } },
    });

    return reply.status(200).send({
      success: true,
      data: {
        mensagemRecebida: message,
        respostaBot: resposta,
        estadoConversa: estadoAtual?.estado ?? 'inicio',
        contexto: estadoAtual?.contextoJson ?? {},
      },
    });
  });

  /**
   * GET /dev/simulate/reset/:phone
   * Reseta o estado da conversa de um telefone de teste para 'inicio'.
   * Útil para recomeçar o fluxo do zero.
   */
  fastify.get('/dev/simulate/reset/:phone', async (request, reply) => {
    const telefone = request.params.phone.replace('@s.whatsapp.net', '').trim();

    const clinica = await prisma.clinica.findFirst({ where: { ativo: true } });
    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Nenhuma clínica ativa encontrada.' });
    }

    // Reseta o estado da conversa
    const estadoExistente = await prisma.estadoConversa.findUnique({
      where: { telefone_clinicaId: { telefone, clinicaId: clinica.id } },
    });

    if (estadoExistente) {
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId: clinica.id } },
        data: { estado: 'inicio', contextoJson: {} },
      });
    }

    // Remove agendamentos de teste deste telefone
    const paciente = await prisma.paciente.findFirst({
      where: { clinicaId: clinica.id, telefone },
      orderBy: { createdAt: 'asc' },
    });

    let agendamentosRemovidos = 0;
    if (paciente) {
      const resultado = await prisma.agendamento.deleteMany({
        where: { pacienteId: paciente.id },
      });
      agendamentosRemovidos = resultado.count;
    }

    return reply.status(200).send({
      success: true,
      data: {
        telefone,
        estadoAnterior: estadoExistente?.estado ?? '(sem estado)',
        estadoAtual: 'inicio',
        agendamentosRemovidos,
        mensagem: 'Conversa resetada. Próxima mensagem começa do zero.',
      },
    });
  });

  /**
   * GET /dev/simulate/state/:phone
   * Retorna o estado atual da conversa de um telefone para debug.
   */
  fastify.get('/dev/simulate/state/:phone', async (request, reply) => {
    const telefone = request.params.phone.replace('@s.whatsapp.net', '').trim();

    const clinica = await prisma.clinica.findFirst({ where: { ativo: true } });
    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Nenhuma clínica ativa encontrada.' });
    }

    const estado = await prisma.estadoConversa.findUnique({
      where: { telefone_clinicaId: { telefone, clinicaId: clinica.id } },
    });

    const paciente = await prisma.paciente.findFirst({
      where: { clinicaId: clinica.id, telefone },
      orderBy: { createdAt: 'asc' },
    });

    const ultimasMensagens = await prisma.conversa.findMany({
      where: { clinicaId: clinica.id, telefone },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { direcao: true, mensagem: true, createdAt: true },
    });

    const agendamentos = paciente
      ? await prisma.agendamento.findMany({
          where: { pacienteId: paciente.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { profissional: { select: { nome: true, especialidade: true } } },
        })
      : [];

    return reply.status(200).send({
      success: true,
      data: {
        telefone,
        clinica: clinica.nome,
        paciente: paciente ? { id: paciente.id, nome: paciente.nome } : null,
        estadoConversa: estado?.estado ?? 'sem estado (nunca enviou mensagem)',
        contexto: estado?.contextoJson ?? {},
        ultimasMensagens: ultimasMensagens.reverse(),
        agendamentos: agendamentos.map((a) => ({
          id: a.id,
          profissional: a.profissional.nome,
          especialidade: a.profissional.especialidade,
          dataHora: a.dataHora,
          status: a.status,
          calendarEventId: a.calendarEventId,
        })),
      },
    });
  });
}
