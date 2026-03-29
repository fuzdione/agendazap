import { prisma } from '../config/database.js';
import { buildSystemPrompt, processMessage } from './claudeService.js';
import { generateMockSlots } from '../utils/mockSlots.js';

// Quantidade máxima de mensagens do histórico enviadas ao Claude
const MAX_HISTORY = 10;

/**
 * Busca os horários disponíveis para todos os profissionais ativos de uma clínica.
 * Por enquanto usa dados fictícios — será substituído por Google Calendar na Etapa 4.
 *
 * @param {Array} profissionais - Lista de profissionais ativos
 * @returns {Array<{ profissional: object, slots: Array }>}
 */
function getAvailableSlots(profissionais) {
  return profissionais.map((p) => ({
    profissional: p,
    slots: generateMockSlots(p.id, p.duracaoConsultaMin ?? 30, 5),
  }));
}

/**
 * Busca ou cria o registro de estado da conversa para um telefone + clínica.
 *
 * @param {string} clinicaId
 * @param {string} telefone
 * @returns {object} - Registro de EstadoConversa
 */
async function getOrCreateEstadoConversa(clinicaId, telefone) {
  let estado = await prisma.estadoConversa.findUnique({
    where: { telefone_clinicaId: { telefone, clinicaId } },
  });

  if (!estado) {
    estado = await prisma.estadoConversa.create({
      data: {
        telefone,
        clinicaId,
        estado: 'inicio',
        contextoJson: {},
      },
    });
  }

  return estado;
}

/**
 * Atualiza o estado da conversa com o novo estado e os dados extraídos pelo Claude.
 * Faz merge do contexto acumulado para preservar informações de turnos anteriores.
 *
 * @param {string} clinicaId
 * @param {string} telefone
 * @param {string} novoEstado
 * @param {object} dadosExtraidos - Dados do campo dados_extraidos do JSON de controle
 * @param {object} contextoAnterior - Contexto já existente
 */
async function atualizarEstadoConversa(clinicaId, telefone, novoEstado, dadosExtraidos, contextoAnterior) {
  // Merge: preserva campos já preenchidos, sobrescreve com os novos não-nulos
  const novoContexto = { ...contextoAnterior };
  for (const [chave, valor] of Object.entries(dadosExtraidos ?? {})) {
    if (valor !== null && valor !== undefined) {
      novoContexto[chave] = valor;
    }
  }

  await prisma.estadoConversa.upsert({
    where: { telefone_clinicaId: { telefone, clinicaId } },
    update: { estado: novoEstado, contextoJson: novoContexto },
    create: { telefone, clinicaId, estado: novoEstado, contextoJson: novoContexto },
  });

  return novoContexto;
}

/**
 * Verifica se todos os dados necessários para criar um agendamento estão presentes.
 * @param {object} contexto
 * @returns {boolean}
 */
function dadosAgendamentoCompletos(contexto) {
  return Boolean(
    contexto.profissional_id &&
    contexto.data_hora &&
    contexto.nome_paciente
  );
}

/**
 * Cria o registro de agendamento no banco e atualiza o paciente com o nome coletado.
 *
 * @param {string} clinicaId
 * @param {object} paciente
 * @param {object} contexto - Contexto acumulado com dados_extraidos
 * @param {object} profissional - Profissional correspondente ao profissional_id
 */
async function criarAgendamento(clinicaId, paciente, contexto, profissional) {
  // Atualiza o nome do paciente se ainda não estiver definido
  if (!paciente.nome && contexto.nome_paciente) {
    await prisma.paciente.update({
      where: { id: paciente.id },
      data: { nome: contexto.nome_paciente },
    });
  }

  const agendamento = await prisma.agendamento.create({
    data: {
      clinicaId,
      profissionalId: contexto.profissional_id,
      pacienteId: paciente.id,
      dataHora: new Date(contexto.data_hora),
      duracaoMin: profissional?.duracaoConsultaMin ?? 30,
      status: 'confirmado',
      // calendarEventId e lembreteEnviado ficam nulos — serão preenchidos na Etapa 4
    },
  });

  console.log(`✅ Agendamento criado: id=${agendamento.id} para paciente ${paciente.id}`);
  return agendamento;
}

/**
 * Orquestrador central do fluxo de conversa.
 * Recebe uma mensagem de texto de um paciente e retorna a resposta do bot.
 *
 * @param {string} clinicaId - ID da clínica
 * @param {string} telefone - Telefone do paciente (formato E.164 sem @)
 * @param {string} mensagemTexto - Texto da mensagem recebida
 * @param {object} clinica - Registro completo da clínica (já buscado no webhook)
 * @returns {Promise<string>} - Mensagem a ser enviada ao paciente
 */
export async function handleIncomingMessage(clinicaId, telefone, mensagemTexto, clinica) {
  // 1. Busca ou cria o paciente
  let paciente = await prisma.paciente.findUnique({
    where: { clinicaId_telefone: { clinicaId, telefone } },
  });

  if (!paciente) {
    paciente = await prisma.paciente.create({
      data: { clinicaId, telefone },
    });
  }

  // 2. Busca ou cria o estado da conversa
  const estadoConversa = await getOrCreateEstadoConversa(clinicaId, telefone);

  // 3. Busca o histórico recente (últimas N mensagens)
  const historico = await prisma.conversa.findMany({
    where: { clinicaId, telefone },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY,
  });

  // 4. Busca profissionais ativos da clínica
  const profissionais = await prisma.profissional.findMany({
    where: { clinicaId, ativo: true },
    orderBy: { nome: 'asc' },
  });

  // 5. Obtém horários disponíveis (mock por enquanto)
  const horariosDisponiveis = getAvailableSlots(profissionais);

  // 6. Monta o system prompt com todo o contexto
  const systemPrompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);

  // 7. Chama o Claude para interpretar a mensagem e gerar a resposta
  const { mensagemParaPaciente, controle } = await processMessage(
    mensagemTexto,
    systemPrompt,
    historico,
    estadoConversa.estado
  );

  // 8. Processa o JSON de controle retornado pelo Claude

  // 8a. Atualiza o estado da conversa com os novos dados extraídos
  const contextoAtualizado = await atualizarEstadoConversa(
    clinicaId,
    telefone,
    controle.novo_estado ?? estadoConversa.estado,
    controle.dados_extraidos ?? {},
    estadoConversa.contextoJson ?? {}
  );

  // 8b. Se a ação for criar agendamento e os dados estiverem completos, cria o registro
  if (controle.acao === 'criar_agendamento' && dadosAgendamentoCompletos(contextoAtualizado)) {
    const profissional = profissionais.find((p) => p.id === contextoAtualizado.profissional_id);

    try {
      await criarAgendamento(clinicaId, paciente, contextoAtualizado, profissional);
    } catch (err) {
      console.error('Erro ao criar agendamento:', err.message);
      // Continua sem travar o fluxo — o Claude já enviou a confirmação ao paciente
    }

    // Reseta o estado para início após agendamento concluído
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'inicio', contextoJson: {} },
    });
  }

  // 8c. Se confiança baixa, adiciona sugestão de contato humano ao final da mensagem
  let respostaFinal = mensagemParaPaciente;
  if ((controle.confianca ?? 1.0) < 0.6) {
    const telefoneClinica = clinica.telefone ?? '';
    const sufixo = telefoneClinica
      ? `\n\nSe preferir, ligue para ${telefoneClinica} para falar com nossa recepção.`
      : '\n\nSe preferir, entre em contato com nossa recepção pelo telefone da clínica.';
    respostaFinal = respostaFinal + sufixo;
  }

  return respostaFinal;
}
