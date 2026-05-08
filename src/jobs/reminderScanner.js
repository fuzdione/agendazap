import { Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { remindersQueue } from '../config/queues.js';
import { ajustarParaDiaUtil } from '../services/reminderService.js';

const TIMEZONE = 'America/Sao_Paulo';

export const reminderScannerWorker = new Worker(
  'reminder-scanner',
  async () => {
    console.log('[reminderScanner] iniciando varredura de agendamentos...');

    const agora = new Date();
    const agoraStr = agora.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const diaSemanaAgora = new Date(`${agoraStr}T12:00:00-03:00`).getDay(); // 0=Dom, 5=Sex, 6=Sab

    // Na sexta, estende a janela até 73h para cobrir a segunda (cujo lembrete
    // seria enviado no domingo → antecipado para sexta pela regra de dia útil)
    const horasMin = 23;
    const horasMax = diaSemanaAgora === 5 ? 73 : 25;

    const dataMin = new Date(agora.getTime() + horasMin * 60 * 60 * 1000);
    const dataMax = new Date(agora.getTime() + horasMax * 60 * 60 * 1000);

    // Só varre 'agendado' — agendamentos já 'confirmado' (pelo paciente ou admin) não
    // precisam de lembrete pedindo confirmação.
    const agendamentos = await prisma.agendamento.findMany({
      where: {
        dataHora: { gte: dataMin, lte: dataMax },
        status: 'agendado',
        lembreteEnviadoAt: null,
      },
      include: { paciente: { select: { id: true, telefone: true } } },
    });

    console.log(`[reminderScanner] ${agendamentos.length} agendamento(s) encontrado(s) na janela ${horasMin}h–${horasMax}h`);

    for (const agendamento of agendamentos) {
      const momentoLembrete = ajustarParaDiaUtil(
        new Date(agendamento.dataHora.getTime() - 24 * 60 * 60 * 1000)
      );
      const delay = momentoLembrete.getTime() - agora.getTime();

      // Se o momento ideal do lembrete já passou (ex: agendado no sábado, sexta já ficou pra trás),
      // não envia no fim de semana — evita disparo acidental fora de hora.
      if (delay < 0) {
        console.log(`[reminderScanner] agendamento ${agendamento.id} ignorado — momento do lembrete já passou (${momentoLembrete.toISOString()})`);
        continue;
      }

      const jobId = `reminder-${agendamento.id}`;

      // BullMQ ignora silenciosamente se o job com mesmo jobId já existir
      await remindersQueue.add('send-reminder', { agendamentoId: agendamento.id }, { jobId, delay });

      console.log(`[reminderScanner] job enfileirado: ${jobId} delay=${Math.round(delay / 1000 / 60)}min`);
    }

    console.log('[reminderScanner] varredura concluída');
  },
  {
    connection: redis,
  }
);

reminderScannerWorker.on('failed', (job, err) => {
  console.error(`❌ [reminderScanner] job ${job?.id} falhou: ${err.message}`);
});

reminderScannerWorker.on('completed', (job) => {
  console.log(`✅ [reminderScanner] varredura ${job.id} concluída`);
});
