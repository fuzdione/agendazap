import { prisma } from '../config/database.js';
import { buildSystemPrompt, processMessage } from './aiService.js';
import { getAvailableSlots as getCalendarSlots, createEvent, checkConflict, deleteEvent } from './calendarService.js';

// Quantidade máxima de mensagens do histórico enviadas ao Claude
const MAX_HISTORY = 10;

// Janela de busca de slots: próximos 7 dias corridos
const JANELA_SLOTS_DIAS = 7;

/**
 * Busca os horários disponíveis para todos os profissionais ativos de uma clínica
 * consultando o Google Calendar de cada um.
 * Se um profissional não tiver calendar ou o Google estiver inacessível, usa mock como fallback.
 *
 * @param {string} clinicaId
 * @param {Array} profissionais - Lista de profissionais ativos
 * @returns {Promise<Array<{ profissional: object, slots: Array }>>}
 */
async function getAvailableSlots(clinicaId, profissionais) {
  const agora = new Date();
  const dataFim = new Date(agora.getTime() + JANELA_SLOTS_DIAS * 24 * 60 * 60 * 1000);

  const resultados = await Promise.all(
    profissionais.map(async (p) => ({
      profissional: p,
      slots: await getCalendarSlots(clinicaId, p.id, agora, dataFim),
    }))
  );

  return resultados;
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
  const nomePaciente = contexto.nome_paciente;

  // Determina o paciente correto para o agendamento (pode ser um familiar diferente)
  let pacienteParaAgendar = paciente;

  if (nomePaciente) {
    // Busca paciente existente com esse nome neste telefone
    const pacienteNomeado = await prisma.paciente.findFirst({
      where: { clinicaId, telefone: paciente.telefone, nome: nomePaciente },
    });

    if (pacienteNomeado) {
      pacienteParaAgendar = pacienteNomeado;
    } else if (!paciente.nome) {
      // Paciente principal ainda sem nome — nomeia-o
      pacienteParaAgendar = await prisma.paciente.update({
        where: { id: paciente.id },
        data: { nome: nomePaciente },
      });
    } else {
      // Paciente principal já tem outro nome — cria novo registro para este familiar
      pacienteParaAgendar = await prisma.paciente.create({
        data: { clinicaId, telefone: paciente.telefone, nome: nomePaciente },
      });
    }
  }

  const agendamento = await prisma.agendamento.create({
    data: {
      clinicaId,
      profissionalId: contexto.profissional_id,
      pacienteId: pacienteParaAgendar.id,
      dataHora: new Date(contexto.data_hora),
      duracaoMin: profissional?.duracaoConsultaMin ?? 30,
      status: 'confirmado',
      // calendarEventId é preenchido logo após a criação do evento no Google Calendar
    },
  });

  console.log(`✅ Agendamento criado: id=${agendamento.id} para ${nomePaciente} (paciente ${pacienteParaAgendar.id})`);
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
  // 1. Busca ou cria o paciente principal (mais antigo deste telefone)
  let paciente = await prisma.paciente.findFirst({
    where: { clinicaId, telefone },
    orderBy: { createdAt: 'asc' },
  });

  if (!paciente) {
    paciente = await prisma.paciente.create({
      data: { clinicaId, telefone },
    });
  }

  // Busca todos os pacientes deste telefone (para nomes conhecidos e agendamentos)
  const pacientesDoTelefone = await prisma.paciente.findMany({
    where: { clinicaId, telefone },
    select: { id: true, nome: true },
    orderBy: { createdAt: 'asc' },
  });
  const nomesConhecidos = pacientesDoTelefone.map((p) => p.nome).filter(Boolean);

  // Agendamentos confirmados futuros deste telefone — enviados ao Claude para remarkação/cancelamento
  const agendamentosAtivos = await prisma.agendamento.findMany({
    where: {
      clinicaId,
      pacienteId: { in: pacientesDoTelefone.map((p) => p.id) },
      status: 'confirmado',
      dataHora: { gte: new Date() },
    },
    include: {
      profissional: { select: { nome: true, especialidade: true } },
      paciente: { select: { nome: true } },
    },
    orderBy: { dataHora: 'asc' },
  });

  // 2. Busca ou cria o estado da conversa
  const estadoConversa = await getOrCreateEstadoConversa(clinicaId, telefone);

  // 3. Busca o histórico recente (últimas N mensagens em ordem cronológica)
  const historico = (await prisma.conversa.findMany({
    where: { clinicaId, telefone },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY,
  })).reverse();

  // 4. Busca profissionais ativos da clínica
  const profissionais = await prisma.profissional.findMany({
    where: { clinicaId, ativo: true },
    orderBy: { nome: 'asc' },
  });

  // 5. Obtém horários disponíveis via Google Calendar (com fallback para mock)
  const horariosDisponiveis = await getAvailableSlots(clinicaId, profissionais);

  // 6. Monta o system prompt com todo o contexto
  const systemPrompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, nomesConhecidos, agendamentosAtivos);

  // 7. Chama o Claude para interpretar a mensagem e gerar a resposta
  const { mensagemParaPaciente, controle } = await processMessage(
    mensagemTexto,
    systemPrompt,
    historico,
    estadoConversa.estado
  );

  // 8. Processa o JSON de controle retornado pelo Claude

  // Ponto 1: log do controle para rastrear acao e dados_extraidos em produção
  console.log(`[controle] telefone=${telefone} acao=${controle.acao} novo_estado=${controle.novo_estado} confianca=${controle.confianca}`);
  console.log(`[controle] dados_extraidos=${JSON.stringify(controle.dados_extraidos)}`);

  // 8a. Atualiza o estado da conversa com os novos dados extraídos
  const contextoAtualizado = await atualizarEstadoConversa(
    clinicaId,
    telefone,
    controle.novo_estado ?? estadoConversa.estado,
    controle.dados_extraidos ?? {},
    estadoConversa.contextoJson ?? {}
  );

  // 8b. Normaliza a ação: se há sinal de remarcação e dados completos, força remarcar_agendamento
  // Cobre dois casos:
  //   (a) modelo retornou criar_agendamento mas agendamento_id está no contexto acumulado
  //   (b) modelo declarou intencao=remarcar mas usou criar_agendamento por erro
  let acaoEfetiva = controle.acao;
  if (acaoEfetiva === 'criar_agendamento' && dadosAgendamentoCompletos(contextoAtualizado)) {
    if (contextoAtualizado.agendamento_id) {
      console.warn(`[controle] acao normalizada: criar_agendamento → remarcar_agendamento (agendamento_id=${contextoAtualizado.agendamento_id})`);
      acaoEfetiva = 'remarcar_agendamento';
    } else if (controle.intencao === 'remarcar') {
      console.warn(`[controle] acao normalizada: criar_agendamento → remarcar_agendamento (intencao=remarcar, sem agendamento_id — usará fallback)`);
      acaoEfetiva = 'remarcar_agendamento';
    }
  }

  let respostaFinal = mensagemParaPaciente;

  if (acaoEfetiva === 'criar_agendamento' && dadosAgendamentoCompletos(contextoAtualizado)) {
    const profissional = profissionais.find((p) => p.id === contextoAtualizado.profissional_id);

    // Guarda das: profissional_id pode ter chegado como nome ou UUID inválido
    if (!profissional) {
      console.error(`[criar_agendamento] profissional_id inválido: "${contextoAtualizado.profissional_id}" — reiniciando seleção`);
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'escolhendo_especialidade', contextoJson: { nome_paciente: contextoAtualizado.nome_paciente } },
      });
      respostaFinal = 'Desculpe, tive um problema ao identificar o profissional. Pode me dizer novamente qual especialidade e horário você deseja? 🙏';
      return respostaFinal;
    }

    // Guarda das: data_hora pode estar em formato não-ISO
    const dataHoraDate = new Date(contextoAtualizado.data_hora);
    if (isNaN(dataHoraDate.getTime())) {
      console.error(`[criar_agendamento] data_hora inválida: "${contextoAtualizado.data_hora}" — reiniciando seleção`);
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'escolhendo_horario', contextoJson: { ...contextoAtualizado, data_hora: null } },
      });
      respostaFinal = 'Desculpe, não consegui interpretar a data escolhida. Pode me informar o dia e horário novamente? 🙏';
      return respostaFinal;
    }

    const duracaoMin = profissional.duracaoConsultaMin;

    // Verifica race condition: outro paciente pode ter agendado o mesmo horário
    const temConflito = await checkConflict(clinicaId, profissional.id, contextoAtualizado.data_hora, duracaoMin);

    if (temConflito) {
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'escolhendo_horario', contextoJson: { ...contextoAtualizado, data_hora: null } },
      });
      respostaFinal =
        'Ops! Esse horário acabou de ser reservado por outro paciente. 😕 ' +
        'Por favor, escolha outro horário na lista que enviei.';
      return respostaFinal;
    }

    let agendamentoCriado = false;
    try {
      const agendamento = await criarAgendamento(clinicaId, paciente, contextoAtualizado, profissional);
      agendamentoCriado = true;

      // Cria o evento correspondente no Google Calendar e salva o ID
      const calendarEventId = await createEvent(clinicaId, profissional.id, {
        dataHora: contextoAtualizado.data_hora,
        duracaoMin,
        nomePaciente: contextoAtualizado.nome_paciente ?? 'Paciente',
        telefonePaciente: telefone,
      });

      if (calendarEventId) {
        await prisma.agendamento.update({
          where: { id: agendamento.id },
          data: { calendarEventId },
        });
      }
    } catch (err) {
      console.error('[criar_agendamento] Falha:', err.message);
      console.error('[criar_agendamento] Contexto:', JSON.stringify(contextoAtualizado));
    }

    if (agendamentoCriado) {
      // Reseta o estado para início apenas após sucesso confirmado
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'inicio', contextoJson: {} },
      });
    } else {
      // Mantém o estado em confirmando para o paciente poder tentar de novo
      respostaFinal =
        'Desculpe, ocorreu um erro ao registrar o agendamento. ' +
        'Por favor, tente confirmar novamente ou entre em contato com a recepção. 🙏';
    }

  } else if (acaoEfetiva === 'remarcar_agendamento' && dadosAgendamentoCompletos(contextoAtualizado)) {
    // Ponto 2: log do contexto ao entrar no fluxo de remarcação
    console.log(`[remarcar_agendamento] contexto=${JSON.stringify(contextoAtualizado)}`);

    const profissional = profissionais.find((p) => p.id === contextoAtualizado.profissional_id);

    if (!profissional) {
      console.error(`[remarcar_agendamento] profissional_id inválido: "${contextoAtualizado.profissional_id}"`);
      respostaFinal = 'Desculpe, tive um problema ao identificar o profissional. Pode me dizer novamente qual consulta deseja remarcar? 🙏';
      return respostaFinal;
    }

    const duracaoMin = profissional.duracaoConsultaMin;

    // Ponto 2: localiza o agendamento original a cancelar
    // Prioridade: agendamento_id do contexto (salvo quando Claude identificou qual remarcar)
    // Fallback: mais recente confirmado do profissional para qualquer paciente deste telefone
    let agendamentoAntigo = null;
    if (contextoAtualizado.agendamento_id) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: { id: contextoAtualizado.agendamento_id, clinicaId },
      });
      console.log(`[remarcar_agendamento] buscou por agendamento_id=${contextoAtualizado.agendamento_id}: ${agendamentoAntigo ? 'encontrado' : 'não encontrado'}`);
    }
    if (!agendamentoAntigo) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: {
          clinicaId,
          profissionalId: profissional.id,
          pacienteId: { in: pacientesDoTelefone.map((p) => p.id) },
          status: 'confirmado',
        },
        orderBy: { dataHora: 'asc' },
      });
      console.log(`[remarcar_agendamento] fallback por profissional: ${agendamentoAntigo ? agendamentoAntigo.id : 'nenhum encontrado'}`);
    }

    // Ponto 3: cancela o agendamento anterior com log explícito
    if (agendamentoAntigo) {
      await prisma.agendamento.update({
        where: { id: agendamentoAntigo.id },
        data: { status: 'cancelado' },
      });
      console.log(`🔄 [remarcar_agendamento] agendamento anterior ${agendamentoAntigo.id} marcado como cancelado`);
      if (agendamentoAntigo.calendarEventId) {
        try {
          await deleteEvent(clinicaId, agendamentoAntigo.profissionalId, agendamentoAntigo.calendarEventId);
          console.log(`🗑️ [remarcar_agendamento] evento Calendar ${agendamentoAntigo.calendarEventId} removido`);
        } catch (err) {
          console.error(`[remarcar_agendamento] falha ao deletar evento Calendar: ${err.message}`);
        }
      }
    } else {
      console.warn('[remarcar_agendamento] nenhum agendamento anterior encontrado para cancelar');
    }

    // Verifica conflito no novo horário antes de criar
    const temConflito = await checkConflict(
      clinicaId,
      contextoAtualizado.profissional_id,
      contextoAtualizado.data_hora,
      duracaoMin
    );

    if (temConflito) {
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'escolhendo_horario', contextoJson: { ...contextoAtualizado, data_hora: null } },
      });
      respostaFinal =
        'Ops! Esse horário acabou de ser reservado por outro paciente. 😕 ' +
        'Por favor, escolha outro horário na lista que enviei.';
      return respostaFinal;
    }

    // Ponto 4: cria novo agendamento e só confirma sucesso após banco + Calendar OK
    let remarcacaoConcluida = false;
    try {
      const novoAgendamento = await criarAgendamento(clinicaId, paciente, contextoAtualizado, profissional);
      console.log(`✅ [remarcar_agendamento] novo agendamento criado: ${novoAgendamento.id}`);
      remarcacaoConcluida = true;

      const calendarEventId = await createEvent(clinicaId, profissional.id, {
        dataHora: contextoAtualizado.data_hora,
        duracaoMin,
        nomePaciente: contextoAtualizado.nome_paciente ?? 'Paciente',
        telefonePaciente: telefone,
      });

      if (calendarEventId) {
        await prisma.agendamento.update({
          where: { id: novoAgendamento.id },
          data: { calendarEventId },
        });
        console.log(`📅 [remarcar_agendamento] evento Calendar criado: ${calendarEventId}`);
      }
    } catch (err) {
      console.error(`[remarcar_agendamento] falha ao criar novo agendamento: ${err.message}`);
      console.error(`[remarcar_agendamento] contexto no erro: ${JSON.stringify(contextoAtualizado)}`);
    }

    // Ponto 4: resposta de sucesso enviada ao paciente SOMENTE após confirmação do banco + Calendar
    if (remarcacaoConcluida) {
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'inicio', contextoJson: {} },
      });
      console.log(`[remarcar_agendamento] concluída com sucesso para ${telefone}`);
      // respostaFinal mantém mensagemParaPaciente (confirmação do Claude)
    } else {
      // Sobreescreve a mensagem do Claude — não envia "remarcado" se o backend falhou
      respostaFinal =
        'Desculpe, ocorreu um erro ao registrar a remarcação. ' +
        'Por favor, tente novamente ou entre em contato com a recepção. 🙏';
    }

  } else if (acaoEfetiva === 'cancelar_agendamento') {
    console.log(`[cancelar_agendamento] contexto=${JSON.stringify(contextoAtualizado)}`);

    // Localiza o agendamento a cancelar pelo agendamento_id ou fallback por profissional
    let agendamentoAntigo = null;
    if (contextoAtualizado.agendamento_id) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: { id: contextoAtualizado.agendamento_id, clinicaId },
      });
      console.log(`[cancelar_agendamento] buscou por agendamento_id=${contextoAtualizado.agendamento_id}: ${agendamentoAntigo ? 'encontrado' : 'não encontrado'}`);
    }
    if (!agendamentoAntigo && contextoAtualizado.profissional_id) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: {
          clinicaId,
          profissionalId: contextoAtualizado.profissional_id,
          pacienteId: { in: pacientesDoTelefone.map((p) => p.id) },
          status: 'confirmado',
        },
        orderBy: { dataHora: 'asc' },
      });
      console.log(`[cancelar_agendamento] fallback por profissional: ${agendamentoAntigo ? agendamentoAntigo.id : 'nenhum encontrado'}`);
    }

    let cancelamentoConcluido = false;
    if (agendamentoAntigo) {
      try {
        await prisma.agendamento.update({
          where: { id: agendamentoAntigo.id },
          data: { status: 'cancelado' },
        });
        console.log(`✅ [cancelar_agendamento] agendamento ${agendamentoAntigo.id} marcado como cancelado`);

        if (agendamentoAntigo.calendarEventId) {
          try {
            await deleteEvent(clinicaId, agendamentoAntigo.profissionalId, agendamentoAntigo.calendarEventId);
            console.log(`🗑️ [cancelar_agendamento] evento Calendar ${agendamentoAntigo.calendarEventId} removido`);
          } catch (err) {
            console.error(`[cancelar_agendamento] falha ao deletar evento Calendar: ${err.message}`);
          }
        }
        cancelamentoConcluido = true;
      } catch (err) {
        console.error(`[cancelar_agendamento] falha ao cancelar no banco: ${err.message}`);
      }
    } else {
      console.warn('[cancelar_agendamento] nenhum agendamento encontrado para cancelar');
    }

    if (cancelamentoConcluido) {
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'inicio', contextoJson: {} },
      });
      console.log(`[cancelar_agendamento] concluído com sucesso para ${telefone}`);
      // respostaFinal mantém mensagemParaPaciente (confirmação do Claude)
    } else {
      respostaFinal =
        'Desculpe, não consegui localizar ou cancelar o agendamento. ' +
        'Por favor, tente novamente ou entre em contato com a recepção. 🙏';
    }
  }

  // 8c. Se confiança baixa, adiciona sugestão de contato humano ao final da mensagem
  /*if ((controle.confianca ?? 1.0) < 0.6) {
    const telefoneClinica = clinica.telefone ?? '';
    const sufixo = telefoneClinica
      ? `\n\nSe preferir, ligue para ${telefoneClinica} para falar com nossa recepção.`
      : '\n\nSe preferir, entre em contato com nossa recepção pelo telefone da clínica.';
    respostaFinal = respostaFinal + sufixo;
  }*/

    // 8c. Se confiança baixa, adiciona sugestão de contato humano ao final da mensagem
    if ((controle.confianca ?? 1.0) < 0.6) {
      const telefoneClinica = clinica.telefone ?? '';

      // Evita duplicar mensagem de contato caso a IA já tenha incluído
      const jaTemContato =
        respostaFinal.toLowerCase().includes('recepção') ||
        respostaFinal.toLowerCase().includes('ligue') ||
        respostaFinal.toLowerCase().includes('telefone');

      if (!jaTemContato) {
        const sufixo = telefoneClinica
          ? `\n\nSe preferir, ligue para ${telefoneClinica} para falar com nossa recepção.`
          : '\n\nSe preferir, entre em contato com nossa recepção pelo telefone da clínica.';

        respostaFinal += sufixo;
      }
    }

  return respostaFinal;
}
