import { Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';

export const checkReminderResponseWorker = new Worker(
  'check-response',
  async (job) => {
    const { agendamentoId } = job.data;

    const agendamento = await prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { paciente: true },
    });

    if (!agendamento) {
      console.log(`[checkReminderResponse] agendamento ${agendamentoId} não encontrado — ignorando`);
      return;
    }

    // Se o paciente já confirmou, cancelou ou teve outro desfecho, não há nada a fazer
    if (agendamento.status !== 'agendado') {
      console.log(`[checkReminderResponse] agendamento ${agendamentoId} status=${agendamento.status} — paciente já agiu, ignorando`);
      return;
    }

    const telefone = agendamento.paciente.telefone;
    const estadoConversa = await prisma.estadoConversa.findUnique({
      where: { telefone_clinicaId: { telefone, clinicaId: agendamento.clinicaId } },
    });

    if (estadoConversa?.estado !== 'aguardando_resposta_lembrete') {
      console.log(`[checkReminderResponse] paciente ${telefone} estado=${estadoConversa?.estado} — já respondeu, ignorando`);
      return;
    }

    // Não respondeu em 4h — reseta estado para não ficar preso
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId: agendamento.clinicaId } },
      data: { estado: 'inicio', contextoJson: {} },
    });

    console.log(`⚠️ [checkReminderResponse] paciente ${telefone} não respondeu ao lembrete em 4h — estado resetado para inicio`);
  },
  {
    connection: redis,
  }
);

checkReminderResponseWorker.on('failed', (job, err) => {
  console.error(`❌ [checkReminderResponse] job ${job?.id} falhou: ${err.message}`);
});

checkReminderResponseWorker.on('completed', (job) => {
  console.log(`✅ [checkReminderResponse] job ${job.id} concluído`);
});
