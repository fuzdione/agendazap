import { google } from 'googleapis';
import { prisma } from '../config/database.js';
import { getAuthenticatedClient } from '../config/google.js';
import { generateMockSlots } from '../utils/mockSlots.js';

const TIMEZONE = 'America/Sao_Paulo';

// Dias da semana em português para montar a resposta
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Antecedência mínima em ms para oferecer um slot (2 horas)
const ANTECEDENCIA_MINIMA_MS = 2 * 60 * 60 * 1000;

/**
 * Lista todos os calendários da conta Google conectada a uma clínica.
 * Usado pelo admin para escolher qual calendar associar a cada profissional.
 *
 * @param {string} clinicaId
 * @returns {Array<{ id: string, summary: string }>}
 */
export async function listCalendars(clinicaId) {
  const auth = await getAuthenticatedClient(clinicaId);
  const calendar = google.calendar({ version: 'v3', auth });

  const { data } = await calendar.calendarList.list();

  return (data.items ?? []).map((cal) => ({
    id: cal.id,
    summary: cal.summary,
    primary: cal.primary ?? false,
  }));
}

/**
 * Retorna os slots de horários disponíveis de um profissional nos próximos dias.
 * Consulta o Google Calendar via freebusy.query para obter horários já ocupados
 * e cruza com o horário de funcionamento configurado na clínica.
 *
 * Fallback: se o Google Calendar estiver inacessível, retorna slots fictícios (mock)
 * e loga um aviso para que o time de suporte possa investigar.
 *
 * @param {string} clinicaId
 * @param {string} profissionalId
 * @param {Date} dataInicio - Início do período de busca
 * @param {Date} dataFim    - Fim do período de busca
 * @returns {Array<{ data: string, dia_semana: string, slots: string[] }>}
 */
export async function getAvailableSlots(clinicaId, profissionalId, dataInicio, dataFim) {
  const profissional = await prisma.profissional.findUnique({
    where: { id: profissionalId },
  });

  if (!profissional?.calendarId) {
    // Profissional sem calendar associado — usa mock como fallback
    console.warn(`⚠️ Profissional ${profissionalId} sem calendarId — usando mock de slots`);
    return generateMockSlots(profissionalId, profissional?.duracaoConsultaMin ?? 30, 5);
  }

  try {
    const auth = await getAuthenticatedClient(clinicaId);
    const calendar = google.calendar({ version: 'v3', auth });

    // Consulta os horários ocupados no período
    const { data: freebusyData } = await calendar.freebusy.query({
      requestBody: {
        timeMin: dataInicio.toISOString(),
        timeMax: dataFim.toISOString(),
        timeZone: TIMEZONE,
        items: [{ id: profissional.calendarId }],
      },
    });

    const periodosOcupados = freebusyData.calendars?.[profissional.calendarId]?.busy ?? [];

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
      select: { configJson: true },
    });

    const config = clinica?.configJson ?? {};

    return gerarSlotsDisponiveis(
      dataInicio,
      dataFim,
      periodosOcupados,
      profissional.duracaoConsultaMin ?? 30,
      config
    );
  } catch (err) {
    // Se for erro de autorização, não tente o fallback — o admin precisa reautorizar
    if (err.code === 'GOOGLE_NOT_AUTHORIZED') {
      console.warn(`⚠️ Clínica ${clinicaId} sem Google Calendar — usando mock de slots`);
      return generateMockSlots(profissionalId, profissional?.duracaoConsultaMin ?? 30, 5);
    }

    // Para outros erros (rede, quota, etc.), loga e usa fallback
    console.error(`❌ Erro ao buscar slots no Google Calendar: ${err.message}`);
    console.warn(`⚠️ Usando mock de slots como fallback para profissional ${profissionalId}`);
    return generateMockSlots(profissionalId, profissional?.duracaoConsultaMin ?? 30, 5);
  }
}

/**
 * Cria um evento no Google Calendar do profissional para o agendamento confirmado.
 *
 * @param {string} clinicaId
 * @param {string} profissionalId
 * @param {object} agendamento - Objeto com dataHora, duracaoMin e dados do paciente
 * @returns {string} ID do evento criado no Google Calendar
 */
export async function createEvent(clinicaId, profissionalId, agendamento) {
  const profissional = await prisma.profissional.findUnique({
    where: { id: profissionalId },
  });

  if (!profissional?.calendarId) {
    console.warn(`⚠️ Profissional ${profissionalId} sem calendarId — evento não criado no Google Calendar`);
    return null;
  }

  const auth = await getAuthenticatedClient(clinicaId);
  const calendar = google.calendar({ version: 'v3', auth });

  const inicio = new Date(agendamento.dataHora);
  const fim = new Date(inicio.getTime() + agendamento.duracaoMin * 60 * 1000);

  const { data: evento } = await calendar.events.insert({
    calendarId: profissional.calendarId,
    requestBody: {
      summary: `Consulta: ${agendamento.nomePaciente}`,
      description: [
        `Tel: ${agendamento.telefonePaciente}`,
        `Especialidade: ${profissional.especialidade}`,
        'Agendado via AgendaZap',
      ].join('\n'),
      start: { dateTime: inicio.toISOString(), timeZone: TIMEZONE },
      end:   { dateTime: fim.toISOString(),   timeZone: TIMEZONE },
    },
  });

  console.log(`📅 Evento criado no Google Calendar: ${evento.id}`);
  return evento.id;
}

/**
 * Remove um evento do Google Calendar (usado quando o paciente cancela o agendamento).
 *
 * @param {string} clinicaId
 * @param {string} profissionalId
 * @param {string} calendarEventId - ID do evento no Google Calendar
 */
export async function deleteEvent(clinicaId, profissionalId, calendarEventId) {
  if (!calendarEventId) return;

  const profissional = await prisma.profissional.findUnique({
    where: { id: profissionalId },
  });

  if (!profissional?.calendarId) return;

  const auth = await getAuthenticatedClient(clinicaId);
  const calendar = google.calendar({ version: 'v3', auth });

  await calendar.events.delete({
    calendarId: profissional.calendarId,
    eventId: calendarEventId,
  });

  console.log(`🗑️ Evento ${calendarEventId} removido do Google Calendar`);
}

/**
 * Verifica se um horário específico ainda está livre no Google Calendar do profissional.
 * Chamada imediatamente antes de confirmar o agendamento para evitar race condition
 * (dois pacientes escolhendo o mesmo horário quase ao mesmo tempo).
 *
 * @param {string} clinicaId
 * @param {string} profissionalId
 * @param {Date|string} dataHora - Início do slot a verificar
 * @param {number} duracaoMin - Duração da consulta em minutos
 * @returns {boolean} true se o horário está livre, false se há conflito
 */
export async function checkConflict(clinicaId, profissionalId, dataHora, duracaoMin) {
  const profissional = await prisma.profissional.findUnique({
    where: { id: profissionalId },
  });

  // Sem calendarId — não há como verificar conflito real; assume que está livre
  if (!profissional?.calendarId) return false;

  try {
    const auth = await getAuthenticatedClient(clinicaId);
    const calendar = google.calendar({ version: 'v3', auth });

    const inicio = new Date(dataHora);
    const fim = new Date(inicio.getTime() + duracaoMin * 60 * 1000);

    const { data: freebusyData } = await calendar.freebusy.query({
      requestBody: {
        timeMin: inicio.toISOString(),
        timeMax: fim.toISOString(),
        timeZone: TIMEZONE,
        items: [{ id: profissional.calendarId }],
      },
    });

    const ocupados = freebusyData.calendars?.[profissional.calendarId]?.busy ?? [];

    // Há conflito se existir algum período ocupado na janela do slot
    return ocupados.length > 0;
  } catch (err) {
    console.error(`❌ Erro ao verificar conflito no Calendar: ${err.message}`);
    // Em caso de erro, conservador: assume sem conflito para não bloquear o paciente
    return false;
  }
}

// ─── Funções internas de geração de slots ──────────────────────────────────

/**
 * Gera os slots disponíveis cruzando o período solicitado com os períodos ocupados.
 *
 * @param {Date} dataInicio
 * @param {Date} dataFim
 * @param {Array<{start: string, end: string}>} periodosOcupados - Períodos busy do freebusy
 * @param {number} duracaoMin
 * @param {object} config - configJson da clínica (horário de funcionamento, intervalos)
 * @returns {Array<{ data: string, dia_semana: string, slots: string[] }>}
 */
function gerarSlotsDisponiveis(dataInicio, dataFim, periodosOcupados, duracaoMin, config) {
  // Configurações com defaults razoáveis
  const horaInicioSemana = config.hora_inicio_semana ?? 8;
  const horaFimSemana    = config.hora_fim_semana    ?? 18;
  const horaInicioSab    = config.hora_inicio_sabado ?? 8;
  const horaFimSab       = config.hora_fim_sabado    ?? 12;
  // intervalo_slots_min é o GAP entre consultas (não o passo de geração)
  const intervaloGapMin  = config.intervalo_slots_min ?? 0;
  const atendeSabado     = config.atende_sabado       ?? false;
  const intervaloAlmoco  = config.intervalo_almoco ?? { inicio: '12:00', fim: '13:00' };

  // Passo = duração da consulta + gap entre consultas
  const passoMin = duracaoMin + intervaloGapMin;

  // Converte períodos ocupados para objetos Date para comparação eficiente
  const ocupados = periodosOcupados.map((p) => ({
    start: new Date(p.start),
    end:   new Date(p.end),
  }));

  const agora = new Date();
  const corteAntecedencia = new Date(agora.getTime() + ANTECEDENCIA_MINIMA_MS);

  // Itera dia a dia dentro do período
  const resultado = [];
  const cursor = new Date(dataInicio);
  cursor.setHours(0, 0, 0, 0);

  while (cursor < dataFim) {
    const diaSemana = cursor.getDay(); // 0=Dom, 6=Sab

    // Pula domingo e sábado (se não atender)
    const ehSabado  = diaSemana === 6;
    const ehDomingo = diaSemana === 0;

    if (!ehDomingo && (!ehSabado || atendeSabado)) {
      const horaInicio = ehSabado ? horaInicioSab : horaInicioSemana;
      const horaFim    = ehSabado ? horaFimSab    : horaFimSemana;

      const slotsNoDia = gerarSlotsNoDia(
        cursor,
        horaInicio,
        horaFim,
        passoMin,
        duracaoMin,
        ocupados,
        corteAntecedencia,
        intervaloAlmoco
      );

      if (slotsNoDia.length > 0) {
        const ano = cursor.getFullYear();
        const mes = String(cursor.getMonth() + 1).padStart(2, '0');
        const dia = String(cursor.getDate()).padStart(2, '0');

        resultado.push({
          data: `${ano}-${mes}-${dia}`,
          dia_semana: DIAS_SEMANA[diaSemana],
          slots: slotsNoDia,
        });
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return resultado;
}

/**
 * Gera os slots disponíveis em um único dia, excluindo horários ocupados, passados e almoço.
 *
 * @param {Date} date - Data base (hora ignorada)
 * @param {number} horaInicio - Hora de início do expediente (ex: 8)
 * @param {number} horaFim    - Hora de fim do expediente (ex: 18)
 * @param {number} passoMin   - Passo entre slots = duração + gap entre consultas
 * @param {number} duracaoMin - Duração da consulta em minutos
 * @param {Array<{start: Date, end: Date}>} ocupados - Intervalos ocupados
 * @param {Date} corteAntecedencia - Momento mínimo permitido para oferecer slot
 * @param {{ inicio: string, fim: string }|null} intervaloAlmoco - Ex: { inicio: "12:00", fim: "13:00" }
 * @returns {string[]} Slots livres no formato "HH:MM"
 */
function gerarSlotsNoDia(date, horaInicio, horaFim, passoMin, duracaoMin, ocupados, corteAntecedencia, intervaloAlmoco) {
  // Converte intervalo de almoço para minutos (ex: "12:00" → 720)
  const parseMinutos = (str) => {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  };
  const almocoInicioMin = intervaloAlmoco ? parseMinutos(intervaloAlmoco.inicio) : null;
  const almocoFimMin    = intervaloAlmoco ? parseMinutos(intervaloAlmoco.fim)    : null;

  const slots = [];
  let minutosCursor = horaInicio * 60;

  while (true) {
    const minutosFim = minutosCursor + duracaoMin;

    // Slot ultrapassa o fim do expediente
    if (minutosFim > horaFim * 60) break;

    // Pula slots que se sobrepõem ao intervalo de almoço
    const sobrepoeAlmoco = almocoInicioMin !== null &&
      minutosCursor < almocoFimMin && minutosFim > almocoInicioMin;

    if (!sobrepoeAlmoco) {
      const slotInicio = new Date(date);
      slotInicio.setHours(Math.floor(minutosCursor / 60), minutosCursor % 60, 0, 0);

      const slotFim = new Date(slotInicio.getTime() + duracaoMin * 60 * 1000);

      // Não oferece slot no passado nem com antecedência insuficiente
      if (slotInicio >= corteAntecedencia) {
        const temConflito = ocupados.some(
          (o) => slotInicio < o.end && slotFim > o.start
        );

        if (!temConflito) {
          const hora   = String(Math.floor(minutosCursor / 60)).padStart(2, '0');
          const minuto = String(minutosCursor % 60).padStart(2, '0');
          slots.push(`${hora}:${minuto}`);
        }
      }
    }

    minutosCursor += passoMin;
  }

  return slots;
}
