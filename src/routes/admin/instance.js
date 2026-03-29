import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import {
  createInstance,
  getQRCode,
  getInstanceStatus,
} from '../../services/whatsappService.js';

/**
 * Rotas administrativas para gerenciar instâncias do WhatsApp.
 * Cada clínica tem uma instância própria na Evolution API.
 */
export async function instanceRoutes(fastify) {
  /**
   * Cria uma instância do WhatsApp para uma clínica.
   * O nome da instância é o telefone da clínica (garante unicidade e facilita lookup no webhook).
   */
  fastify.post('/admin/instance/create', {
    schema: {
      body: {
        type: 'object',
        required: ['clinicaId'],
        properties: {
          clinicaId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { clinicaId } = request.body;

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    // URL do webhook — o servidor precisa ser acessível pela Evolution API
    // Em dev local, use ngrok ou similar para expor o localhost
    const webhookUrl = `${env.SERVER_URL ?? `http://localhost:${env.PORT}`}/webhook/whatsapp`;

    try {
      const data = await createInstance(clinica.telefoneWpp, webhookUrl);
      return reply.send({ success: true, data });
    } catch (err) {
      request.log.error({ msg: 'Erro ao criar instância', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * Retorna o QR code para conectar o celular da clínica ao WhatsApp.
   * Deve ser escaneado com o WhatsApp do número cadastrado na clínica.
   */
  fastify.get('/admin/instance/:clinicaId/qrcode', async (request, reply) => {
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
      request.log.error({ msg: 'Erro ao buscar QR code', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * Retorna o status de conexão do WhatsApp da clínica.
   * Estados possíveis: open (conectado), close (desconectado), connecting (aguardando QR).
   */
  fastify.get('/admin/instance/:clinicaId/status', async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    try {
      const data = await getInstanceStatus(clinica.telefoneWpp);
      return reply.send({ success: true, data });
    } catch (err) {
      request.log.error({ msg: 'Erro ao buscar status da instância', error: err.message });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
