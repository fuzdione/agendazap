import { Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { checkResponseQueue } from '../config/queues.js';
import { getEventById } from '../services/calendarService.js';
import { sendTextMessage } from '../services/whatsappService.js';

const TIMEZONE = 'America/Sao_Paulo';
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const sendReminderWorker = new Worker(
  'reminders',
  async (job) => {
    const { agendamentoId } = job.data;

    if (!agendamentoId) {
      console.error('[sendReminder] job sem agendamentoId — ignorando');
      return;
    }

    // Hard stop — valida antes de qualquer ação
    const agendamento = await prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: {
        paciente: true,
        profissional: true,
        clinica: true,
      },
    });

    if (!agendamento) {
      console.log(`[sendReminder] agendamento ${agendamentoId} não encontrado — ignorando`);
      return;
    }
    if (agendamento.status !== 'confirmado') {
      console.log(`[sendReminder] agendamento ${agendamentoId} status=${agendamento.status} — ignorando`);
      return;
    }
    if (agendamento.lembreteEnviadoAt) {
      console.log(`[sendReminder] agendamento ${agendamentoId} já notificado em ${agendamento.lembreteEnviadoAt} — ignorando`);
      return;
    }

    // Verifica horário no Google Calendar — detecta mudanças manuais feitas pela recepção
    let dataHoraFinal = agendamento.dataHora;
    if (agendamento.calendarEventId) {
      try {
        const evento = await getEventById(
          agendamento.clinicaId,
          agendamento.profissionalId,
          agendamento.calendarEventId
        );
        if (evento?.start?.dateTime) {
          const dataHoraEvento = new Date(evento.start.dateTime);
          // Atualiza silenciosamente se houver diferença > 1 minuto
          if (Math.abs(dataHoraEvento.getTime() - agendamento.dataHora.getTime()) > 60000) {
            console.log(`[sendReminder] horário alterado no Calendar: banco=${agendamento.dataHora.toISOString()} → Calendar=${dataHoraEvento.toISOString()}`);
            await prisma.agendamento.update({
              where: { id: agendamentoId },
              data: { dataHora: dataHoraEvento },
            });
            dataHoraFinal = dataHoraEvento;
          }
        }
      } catch (err) {
        console.error(`[sendReminder] erro ao verificar Calendar: ${err.message}`);
      }
    }

    // Formata data/hora no fuso correto
    const dataStr = dataHoraFinal.toLocaleDateString('pt-BR', {
      timeZone: TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const horaStr = dataHoraFinal.toLocaleTimeString('pt-BR', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
    });
    const dataKey = dataHoraFinal.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const diaSemanaStr = DIAS_SEMANA[new Date(`${dataKey}T12:00:00-03:00`).getDay()];

    const nomePaciente = agendamento.paciente.nome ?? 'Paciente';
    const nomeProfissional = agendamento.profissional.nome;
    const especialidade = agendamento.profissional.especialidade;
    const endereco = agendamento.clinica.endereco ?? '';

    const mensagem =
      `Oi, ${nomePaciente}! 👋\n` +
      `Lembrete da sua consulta:\n` +
      `🩺 ${especialidade} — Dr(a). ${nomeProfissional}\n` +
      `📅 ${diaSemanaStr}, ${dataStr} às ${horaStr}\n` +
      (endereco ? `📍 ${endereco}\n` : '') +
      `\nO que deseja fazer?\n` +
      `1️⃣ Confirmar presença\n` +
      `2️⃣ Remarcar consulta\n` +
      `3️⃣ Cancelar consulta`;

    const instanceName = agendamento.clinica.telefoneWpp;
    const telefone = agendamento.paciente.telefone;

    await sendTextMessage(instanceName, telefone, mensagem);
    console.log(`✅ [sendReminder] lembrete enviado para ${telefone} (agendamento ${agendamentoId})`);

    // Marca lembrete como enviado (idempotência)
    await prisma.agendamento.update({
      where: { id: agendamentoId },
      data: { lembreteEnviadoAt: new Date() },
    });

    // Atualiza EstadoConversa apenas se o paciente não estiver em fluxo ativo
    const estadoAtual = await prisma.estadoConversa.findUnique({
      where: { telefone_clinicaId: { telefone, clinicaId: agendamento.clinicaId } },
    });

    const estadosPermitidos = ['inicio', 'concluido'];
    if (!estadoAtual || estadosPermitidos.includes(estadoAtual.estado)) {
      await prisma.estadoConversa.upsert({
        where: { telefone_clinicaId: { telefone, clinicaId: agendamento.clinicaId } },
        update: {
          estado: 'aguardando_resposta_lembrete',
          contextoJson: { agendamento_id: agendamentoId },
        },
        create: {
          telefone,
          clinicaId: agendamento.clinicaId,
          estado: 'aguardando_resposta_lembrete',
          contextoJson: { agendamento_id: agendamentoId },
        },
      });
    } else {
      console.log(`[sendReminder] paciente ${telefone} em fluxo ativo (${estadoAtual.estado}) — estado não sobrescrito`);
    }

    // Salva na tabela conversas
    await prisma.conversa.create({
      data: {
        clinicaId: agendamento.clinicaId,
        pacienteId: agendamento.pacienteId,
        telefone,
        direcao: 'saida',
        mensagem,
        metadataJson: { tipo: 'lembrete', agendamentoId },
      },
    });

    // Enfileira verificação de resposta para 4h após o envio
    await checkResponseQueue.add(
      'check-response',
      { agendamentoId },
      {
        jobId: `check-response-${agendamentoId}`,
        delay: 4 * 60 * 60 * 1000,
      }
    );

    console.log(`⏰ [sendReminder] verificação de resposta agendada para daqui 4h (agendamento ${agendamentoId})`);
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

sendReminderWorker.on('failed', (job, err) => {
  console.error(`❌ [sendReminder] job ${job?.id} falhou (tentativa ${job?.attemptsMade}): ${err.message}`);
});

sendReminderWorker.on('completed', (job) => {
  console.log(`✅ [sendReminder] job ${job.id} concluído`);
});
