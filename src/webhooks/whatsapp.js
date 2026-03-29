import { prisma } from '../config/database.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { formatFromWhatsApp } from '../utils/phoneHelper.js';

/**
 * Registra a rota POST /webhook/whatsapp no servidor Fastify.
 * Esta rota recebe todos os eventos da Evolution API.
 */
export async function whatsappWebhookRoutes(fastify) {
  fastify.post('/webhook/whatsapp', async (request, reply) => {
    const payload = request.body;

    // A Evolution API envia vários tipos de evento — só nos interessa messages.upsert
    if (payload?.event !== 'messages.upsert') {
      return reply.status(200).send({ received: true });
    }

    const messageData = payload?.data;
    const key = messageData?.key;
    const message = messageData?.message;

    // --- Filtros: ignora mensagens que não devem ser processadas ---

    // Ignora mensagens enviadas por nós mesmos
    if (key?.fromMe === true) {
      return reply.status(200).send({ received: true });
    }

    const remoteJid = key?.remoteJid ?? '';

    // Ignora mensagens de grupos
    if (remoteJid.includes('@g.us')) {
      return reply.status(200).send({ received: true });
    }

    // Ignora status/broadcast do WhatsApp
    if (remoteJid === 'status@broadcast') {
      return reply.status(200).send({ received: true });
    }

    // Extrai o texto da mensagem (apenas texto simples por enquanto)
    const textoMensagem = message?.conversation || message?.extendedTextMessage?.text;
    const isTextMessage = Boolean(textoMensagem);

    // Extrai o número que recebeu a mensagem — identifica a clínica
    // O campo instance.name ou instanceName no payload da Evolution contém o nome da instância
    const instanceName = payload?.instance ?? payload?.instanceName ?? '';

    // Número do remetente (paciente)
    const telefoneRemetente = formatFromWhatsApp(remoteJid);

    request.log.info({
      msg: 'Webhook recebido',
      instance: instanceName,
      de: telefoneRemetente,
      tipo: isTextMessage ? 'texto' : 'mídia',
    });

    try {
      // Identifica a clínica pelo nome da instância (que é o telefone da clínica)
      // O instanceName é criado com o telefone da clínica em POST /admin/instance/create
      const clinica = await prisma.clinica.findFirst({
        where: { telefoneWpp: instanceName, ativo: true },
      });

      if (!clinica) {
        request.log.warn(`Nenhuma clínica encontrada para a instância: ${instanceName}`);
        return reply.status(200).send({ received: true });
      }

      // Se não for mensagem de texto, responde avisando a limitação
      if (!isTextMessage) {
        await sendTextMessage(
          instanceName,
          telefoneRemetente,
          'Desculpe, por enquanto só consigo ler mensagens de texto 😊'
        );
        return reply.status(200).send({ received: true });
      }

      // Busca ou cria o paciente
      let paciente = await prisma.paciente.findUnique({
        where: {
          clinicaId_telefone: {
            clinicaId: clinica.id,
            telefone: telefoneRemetente,
          },
        },
      });

      if (!paciente) {
        paciente = await prisma.paciente.create({
          data: {
            clinicaId: clinica.id,
            telefone: telefoneRemetente,
          },
        });
      }

      // Salva a mensagem recebida (entrada)
      await prisma.conversa.create({
        data: {
          clinicaId: clinica.id,
          pacienteId: paciente.id,
          telefone: telefoneRemetente,
          direcao: 'entrada',
          mensagem: textoMensagem,
        },
      });

      // Placeholder: resposta fixa até a IA ser integrada na Etapa 3
      const resposta = `Olá! Sou o assistente da ${clinica.nome}. Em breve poderei te ajudar a agendar consultas! 😊`;

      await sendTextMessage(instanceName, telefoneRemetente, resposta);

      // Salva a mensagem enviada (saída)
      await prisma.conversa.create({
        data: {
          clinicaId: clinica.id,
          pacienteId: paciente.id,
          telefone: telefoneRemetente,
          direcao: 'saida',
          mensagem: resposta,
        },
      });

      request.log.info(`Resposta enviada para ${telefoneRemetente} — clínica: ${clinica.nome}`);

    } catch (err) {
      request.log.error({ msg: 'Erro ao processar webhook', error: err.message });
      // Sempre retorna 200 para a Evolution API não ficar reenviando o mesmo evento
    }

    return reply.status(200).send({ received: true });
  });
}
