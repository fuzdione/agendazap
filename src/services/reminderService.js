import { prisma } from '../config/database.js';
import { remindersQueue } from '../config/queues.js';

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Ajusta a data/hora do lembrete para um dia útil (segunda–sexta).
 * Se cair em sábado (6) ou domingo (0), recua para a sexta-feira anterior
 * mantendo o mesmo horário.
 * Usa o fuso horário America/Sao_Paulo para calcular o dia da semana.
 *
 * Exemplos:
 *   Consulta segunda 09:00 → lembrete domingo 09:00 → enviado na sexta 09:00
 *   Consulta sábado 14:00  → lembrete sexta 14:00  → ok (sexta já é útil)
 *
 * @param {Date} dataHoraLembrete
 * @returns {Date}
 */
export function ajustarParaDiaUtil(dataHoraLembrete) {
  const dataStr = dataHoraLembrete.toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // "YYYY-MM-DD"
  const diaSemana = new Date(`${dataStr}T12:00:00-03:00`).getDay(); // 0=Dom, 6=Sab

  if (diaSemana === 6) {
    // Sábado → recua 1 dia para sexta
    return new Date(dataHoraLembrete.getTime() - 1 * 24 * 60 * 60 * 1000);
  }
  if (diaSemana === 0) {
    // Domingo → recua 2 dias para sexta
    return new Date(dataHoraLembrete.getTime() - 2 * 24 * 60 * 60 * 1000);
  }

  return dataHoraLembrete;
}

/**
 * Enfileira um job de lembrete para o agendamento, se o paciente tem opt-in.
 * Se o agendamento ocorre em mais de 25h, não enfileira agora — o cron horário fará isso.
 * O jobId garante deduplicação automática.
 *
 * @param {string} agendamentoId
 */
export async function scheduleReminderIfNeeded(agendamentoId) {
  const agendamento = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
  });

  if (!agendamento) {
    console.warn(`[reminderService] agendamento ${agendamentoId} não encontrado`);
    return;
  }

  if (!['agendado', 'confirmado'].includes(agendamento.status)) {
    console.log(`[reminderService] agendamento ${agendamentoId} status=${agendamento.status} — sem lembrete`);
    return;
  }

  const agora = Date.now();
  const dataHoraMs = agendamento.dataHora.getTime();
  const diferencaMs = dataHoraMs - agora;

  // Consulta em menos de 4h: paciente acabou de agendar, lembrete é desnecessário
  const MIN_ANTECEDENCIA_MS = 4 * 60 * 60 * 1000;
  if (diferencaMs < MIN_ANTECEDENCIA_MS) {
    console.log(`[reminderService] agendamento ${agendamentoId} ocorre em menos de 4h — lembrete não enviado`);
    return;
  }

  // Consulta em mais de 25h: cron horário cuidará do agendamento
  if (diferencaMs > 25 * 60 * 60 * 1000) {
    console.log(`[reminderService] agendamento ${agendamentoId} ocorre em mais de 25h — cron horário enfileirará`);
    return;
  }

  // Calcula momento do lembrete = dataHora - 24h, ajustado para dia útil
  const momentoLembrete = ajustarParaDiaUtil(new Date(dataHoraMs - 24 * 60 * 60 * 1000));

  // Se a janela de 24h já passou, aplica delay mínimo de 1h para evitar disparo imediato
  const DELAY_MINIMO_MS = 60 * 60 * 1000;
  const delayIdeal = momentoLembrete.getTime() - agora;
  const delay = delayIdeal >= 0 ? delayIdeal : DELAY_MINIMO_MS;

  if (delayIdeal < 0) {
    console.log(`[reminderService] janela de 24h já passou — aplicando delay mínimo de 1h`);
  }

  const jobId = `reminder-${agendamentoId}`;

  await remindersQueue.add('send-reminder', { agendamentoId }, { jobId, delay });

  await prisma.agendamento.update({
    where: { id: agendamentoId },
    data: { reminderJobId: jobId },
  });

  console.log(`⏰ [reminderService] lembrete agendado: jobId=${jobId} delay=${Math.round(delay / 1000 / 60)}min`);
}

/**
 * Remove o job de lembrete de um agendamento da fila, se existir.
 * Chamado ao cancelar ou ao remarcar (para o agendamento antigo).
 *
 * @param {string} agendamentoId
 */
export async function cancelReminder(agendamentoId) {
  if (!agendamentoId) return;

  const agendamento = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    select: { reminderJobId: true },
  });

  if (!agendamento?.reminderJobId) {
    console.log(`[reminderService] sem reminderJobId para agendamento ${agendamentoId} — nada a cancelar`);
    return;
  }

  const jobId = agendamento.reminderJobId;

  try {
    const job = await remindersQueue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`🗑️ [reminderService] job ${jobId} removido da fila`);
    } else {
      console.log(`[reminderService] job ${jobId} não encontrado na fila — pode já ter sido processado`);
    }
  } catch (err) {
    console.error(`[reminderService] erro ao remover job ${jobId}: ${err.message}`);
  }
}
