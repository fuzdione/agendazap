/**
 * Gera horários de consulta fictícios para simular uma agenda parcialmente ocupada.
 * Usado enquanto a integração real com Google Calendar (Etapa 4) não está disponível.
 */

const HORA_INICIO = 8;  // 08:00
const HORA_FIM = 18;    // 18:00

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * Verifica se uma data é dia útil (segunda a sexta).
 * @param {Date} date
 * @returns {boolean}
 */
function isDiaUtil(date) {
  const diaSemana = date.getDay();
  return diaSemana >= 1 && diaSemana <= 5;
}

/**
 * Gera os próximos N dias úteis a partir de amanhã.
 * @param {number} quantidade
 * @returns {Date[]}
 */
function getProximosDiasUteis(quantidade) {
  const dias = [];
  // Usa fuso horário de Brasília para calcular as datas
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  hoje.setHours(0, 0, 0, 0);

  const cursor = new Date(hoje);
  cursor.setDate(cursor.getDate() + 1); // começa amanhã

  while (dias.length < quantidade) {
    if (isDiaUtil(cursor)) {
      dias.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dias;
}

/**
 * Gera todos os horários possíveis em um dia para uma dada duração de consulta.
 * @param {Date} date
 * @param {number} duracaoMin - Duração da consulta em minutos
 * @returns {string[]} - Array de horários no formato "HH:MM"
 */
function gerarHorariosNoDia(date, duracaoMin) {
  const slots = [];
  let horaAtual = HORA_INICIO;
  let minutoAtual = 0;

  while (true) {
    // Verifica se o slot + duração cabem dentro do expediente
    const minutosTotal = horaAtual * 60 + minutoAtual + duracaoMin;
    if (minutosTotal > HORA_FIM * 60) break;

    const hora = String(horaAtual).padStart(2, '0');
    const minuto = String(minutoAtual).padStart(2, '0');
    slots.push(`${hora}:${minuto}`);

    // Avança pelo intervalo da consulta
    minutoAtual += duracaoMin;
    if (minutoAtual >= 60) {
      horaAtual += Math.floor(minutoAtual / 60);
      minutoAtual = minutoAtual % 60;
    }
  }

  return slots;
}

/**
 * Remove aleatoriamente entre 30% e 40% dos slots para simular agenda ocupada.
 * Usa o profissionalId como semente para que o mesmo profissional tenha resultados
 * consistentes durante uma conversa.
 * @param {string[]} slots
 * @param {string} profissionalId - Usado como base para pseudoaleatoriedade determinística
 * @param {string} dataStr - Data no formato "YYYY-MM-DD"
 * @returns {string[]}
 */
function removerSlotsAleatorios(slots, profissionalId, dataStr) {
  // Semente simples: soma dos char codes do id + data para ser determinístico por profissional/dia
  const semente = (profissionalId + dataStr)
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);

  // Taxa de remoção entre 30% e 40%
  const taxaRemocao = 0.30 + (semente % 11) / 100;

  return slots.filter((_, idx) => {
    // Pseudoaleatório determinístico simples
    const hash = (semente * (idx + 7)) % 100;
    return hash >= taxaRemocao * 100;
  });
}

/**
 * Gera slots de horários disponíveis fictícios para os próximos dias úteis.
 *
 * @param {string} profissionalId - ID do profissional (UUID)
 * @param {number} duracaoMin - Duração da consulta em minutos (default 30)
 * @param {number} diasUteis - Quantos dias úteis gerar (default 5)
 * @returns {Array<{ data: string, dia_semana: string, slots: string[] }>}
 */
export function generateMockSlots(profissionalId, duracaoMin = 30, diasUteis = 5) {
  const dias = getProximosDiasUteis(diasUteis);

  return dias
    .map((date) => {
      // Formata como "YYYY-MM-DD" no fuso de Brasília
      const ano = date.getFullYear();
      const mes = String(date.getMonth() + 1).padStart(2, '0');
      const dia = String(date.getDate()).padStart(2, '0');
      const dataStr = `${ano}-${mes}-${dia}`;

      const diaSemana = DIAS_SEMANA[date.getDay()];

      const todosSlots = gerarHorariosNoDia(date, duracaoMin);
      const slotsDisponiveis = removerSlotsAleatorios(todosSlots, profissionalId, dataStr);

      return {
        data: dataStr,
        dia_semana: diaSemana,
        slots: slotsDisponiveis,
      };
    })
    // Remove dias que ficaram sem nenhum slot disponível
    .filter((d) => d.slots.length > 0);
}
