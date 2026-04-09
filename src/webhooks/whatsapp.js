import { prisma } from '../config/database.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { handleIncomingMessage } from '../services/conversationService.js';
import { formatFromWhatsApp } from '../utils/phoneHelper.js';
import { env } from '../config/env.js';

// Whitelist de remetentes permitidos (vazia = aceita todos)
const WHITELIST = env.TEST_PHONE_WHITELIST
  ? env.TEST_PHONE_WHITELIST.split(',').map((n) => n.trim()).filter(Boolean)
  : [];

// Mensagens mais antigas que este limite são ignoradas ao subir o servidor
// (evita processar fila acumulada durante downtime)
const MAX_MESSAGE_AGE_MS = 30 * 60 * 1000; // 30 minutos

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

    // @lid = ID interno de privacidade do WhatsApp — Evolution API não suporta envio para esse formato
    if (remoteJid.includes('@lid')) {
      request.log.warn({ msg: 'Ignorado: @lid não suportado pela Evolution API', jid: remoteJid });
      return reply.status(200).send({ received: true });
    }

    // Ignora mensagens antigas acumuladas durante downtime do servidor
    const messageTimestamp = messageData?.messageTimestamp;
    if (messageTimestamp) {
      const idadeMs = Date.now() - messageTimestamp * 1000;
      if (idadeMs > MAX_MESSAGE_AGE_MS) {
        request.log.warn({
          msg: 'Mensagem ignorada — muito antiga (downtime)',
          idadeMin: Math.round(idadeMs / 60000),
          de: formatFromWhatsApp(key?.remoteJid ?? ''),
        });
        return reply.status(200).send({ received: true });
      }
    }

    // Extrai o texto da mensagem (apenas texto simples por enquanto)
    const textoMensagem = message?.conversation || message?.extendedTextMessage?.text;
    const isTextMessage = Boolean(textoMensagem);

    // Extrai o número que recebeu a mensagem — identifica a clínica
    const instanceName = payload?.instance ?? payload?.instanceName ?? '';

    // Número do remetente (paciente)
    const telefoneRemetente = formatFromWhatsApp(remoteJid);

    // Whitelist de teste — se definida, ignora números não listados
    if (WHITELIST.length > 0 && !WHITELIST.includes(telefoneRemetente)) {
      return reply.status(200).send({ received: true });
    }

    request.log.info({
      msg: 'Webhook recebido',
      instance: instanceName,
      de: telefoneRemetente,
      tipo: isTextMessage ? 'texto' : 'mídia',
    });

    // Responde 200 IMEDIATAMENTE para a Evolution API não retentar.
    // O processamento pesado (Google Calendar + IA + envio) acontece em background.
    reply.status(200).send({ received: true });

    // Processa a mensagem de forma assíncrona
    setImmediate(async () => {
      try {
        // Identifica a clínica pelo nome da instância (que é o telefone da clínica)
        const clinica = await prisma.clinica.findFirst({
          where: { telefoneWpp: instanceName, ativo: true },
        });

        if (!clinica) {
          fastify.log.warn(`Nenhuma clínica encontrada para a instância: ${instanceName}`);
          return;
        }

        // Se não for mensagem de texto, responde avisando a limitação
        if (!isTextMessage) {
          await sendTextMessage(
            instanceName,
            remoteJid,
            'Desculpe, por enquanto só consigo ler mensagens de texto 😊'
          );
          return;
        }

        // Busca ou cria o paciente para poder salvar a mensagem de entrada
        let paciente = await prisma.paciente.findFirst({
          where: { clinicaId: clinica.id, telefone: telefoneRemetente },
          orderBy: { createdAt: 'asc' },
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
          fastify.log.error({ msg: 'Erro no processamento pela IA', error: iaErr.message });
          const telefoneClinica = clinica.telefone ?? '';
          resposta = telefoneClinica
            ? `Desculpe, tive um probleminha técnico. Pode repetir sua mensagem? Se preferir, ligue para ${telefoneClinica}.`
            : 'Desculpe, tive um probleminha técnico. Pode repetir sua mensagem? 🙏';
        }

        await sendTextMessage(instanceName, remoteJid, resposta);

        // Recarrega o paciente — conversationService pode ter atualizado o nome
        const pacienteAtualizado = await prisma.paciente.findFirst({
          where: { clinicaId: clinica.id, telefone: telefoneRemetente },
          orderBy: { createdAt: 'asc' },
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

        fastify.log.info(`Resposta enviada para ${telefoneRemetente} — clínica: ${clinica.nome}`);

      } catch (err) {
        fastify.log.error({ msg: 'Erro ao processar mensagem em background', error: err.message });
      }
    });
  });
}
