import { prisma } from '../config/database.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { handleIncomingMessage } from '../services/conversationService.js';
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

    // Ignora mensagens com @lid — WhatsApp novo protocolo dispara o webhook duas vezes:
    // uma com @lid e outra com @s.whatsapp.net. Processamos apenas a versão @s.whatsapp.net.
    if (remoteJid.endsWith('@lid')) {
      return reply.status(200).send({ received: true });
    }

    // Extrai o texto da mensagem (apenas texto simples por enquanto)
    const textoMensagem = message?.conversation || message?.extendedTextMessage?.text;
    const isTextMessage = Boolean(textoMensagem);

    // Extrai o número que recebeu a mensagem — identifica a clínica
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
          remoteJid,
          'Desculpe, por enquanto só consigo ler mensagens de texto 😊'
        );
        return reply.status(200).send({ received: true });
      }

      // Busca ou cria o paciente para poder salvar a mensagem de entrada
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

      // Salva a mensagem recebida (entrada) antes de processar
      await prisma.conversa.create({
        data: {
          clinicaId: clinica.id,
          pacienteId: paciente.id,
          telefone: telefoneRemetente,
          direcao: 'entrada',
          mensagem: textoMensagem,
        },
      });

      // Chama o orquestrador de conversa com IA
      let resposta;
      try {
        resposta = await handleIncomingMessage(clinica.id, telefoneRemetente, textoMensagem, clinica);
      } catch (iaErr) {
        request.log.error({ msg: 'Erro no processamento pela IA', error: iaErr.message });
        const telefoneClinica = clinica.telefone ?? '';
        resposta = telefoneClinica
          ? `Desculpe, tive um probleminha técnico. Pode repetir sua mensagem? Se preferir, ligue para ${telefoneClinica}.`
          : 'Desculpe, tive um probleminha técnico. Pode repetir sua mensagem? 🙏';
      }

      await sendTextMessage(instanceName, remoteJid, resposta);

      // Recarrega o paciente — conversationService pode ter atualizado o nome
      const pacienteAtualizado = await prisma.paciente.findUnique({
        where: { clinicaId_telefone: { clinicaId: clinica.id, telefone: telefoneRemetente } },
      });

      // Salva a mensagem enviada (saída)
      await prisma.conversa.create({
        data: {
          clinicaId: clinica.id,
          pacienteId: (pacienteAtualizado ?? paciente).id,
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
