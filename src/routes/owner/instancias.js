import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import {
  createInstance,
  getQRCode,
  getInstanceStatus,
  logoutInstance,
  deleteInstance,
} from '../../services/whatsappService.js';

/**
 * Consulta status de uma instância com timeout de 5s.
 * Retorna objeto { status, ultimaConexao } ou indica sem_instancia em caso de falha.
 */
async function fetchStatusComTimeout(telefoneWpp) {
  try {
    const data = await Promise.race([
      getInstanceStatus(telefoneWpp),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    const state = data?.instance?.state ?? data?.state ?? 'unknown';
    return {
      status: state === 'open' ? 'conectado' : 'desconectado',
      statusRaw: state,
    };
  } catch {
    return { status: 'sem_instancia', statusRaw: null };
  }
}

/**
 * Rotas de gerenciamento de instâncias WhatsApp para o proprietário da solução.
 */
export async function ownerInstanciasRoutes(fastify) {
  /**
   * Lista todas as clínicas com status de cada instância WhatsApp.
   */
  fastify.get('/owner/instancias', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const clinicas = await prisma.clinica.findMany({
      select: { id: true, nome: true, telefoneWpp: true, ativo: true },
      orderBy: { nome: 'asc' },
    });

    const resultados = await Promise.allSettled(
      clinicas.map(async (clinica) => {
        const { status, statusRaw } = clinica.ativo
          ? await fetchStatusComTimeout(clinica.telefoneWpp)
          : { status: 'inativa', statusRaw: null };

        return {
          clinicaId: clinica.id,
          nome: clinica.nome,
          telefone: clinica.telefoneWpp,
          ativo: clinica.ativo,
          status,
          statusRaw,
        };
      }),
    );

    const lista = resultados.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      // Fallback seguro se algo inesperado acontecer
      return { status: 'erro', erro: r.reason?.message };
    });

    return reply.send({ success: true, data: lista });
  });

  /**
   * Cria instância WhatsApp para uma clínica.
   * Reutiliza a lógica de POST /admin/instance/create.
   */
  fastify.post('/owner/instancias/:clinicaId/criar', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    const webhookUrl = `${env.SERVER_URL ?? `http://localhost:${env.PORT}`}/webhook/whatsapp`;

    try {
      const data = await createInstance(clinica.telefoneWpp, webhookUrl);
      return reply.send({ success: true, data });
    } catch (err) {
      request.log.error({ msg: 'Erro ao criar instância (owner)', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * Desconecta o WhatsApp de uma instância (logout). A instância continua existindo
   * na Evolution API, mas precisará de novo QR code para reconectar.
   */
  fastify.delete('/owner/instancias/:clinicaId/logout', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    try {
      const data = await logoutInstance(clinica.telefoneWpp);
      return reply.send({ success: true, data });
    } catch (err) {
      request.log.error({ msg: 'Erro ao desconectar instância (owner)', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * Remove permanentemente a instância da Evolution API.
   */
  fastify.delete('/owner/instancias/:clinicaId/deletar', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    try {
      const data = await deleteInstance(clinica.telefoneWpp);
      return reply.send({ success: true, data });
    } catch (err) {
      request.log.error({ msg: 'Erro ao deletar instância (owner)', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * Retorna o QR code para conectar o WhatsApp de uma clínica.
   * Reutiliza a lógica de GET /admin/instance/:id/qrcode.
   */
  fastify.get('/owner/instancias/:clinicaId/qrcode', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    try {
      const data = await getQRCode(clinica.telefoneWpp);
      return reply.send({ success: true, data });
    } catch (err) {
      request.log.error({ msg: 'Erro ao buscar QR code (owner)', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
