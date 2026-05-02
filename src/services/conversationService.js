import { prisma } from '../config/database.js';
import { buildSystemPrompt, processMessage } from './aiService.js';
import { getAvailableSlots as getCalendarSlots, createEvent, checkConflict, deleteEvent, patchEventTitle } from './calendarService.js';
import { scheduleReminderIfNeeded, cancelReminder } from './reminderService.js';

// Quantidade máxima de mensagens do histórico enviadas ao Claude
const MAX_HISTORY = 10;

// Janela de busca de slots: próximos 7 dias corridos
const JANELA_SLOTS_DIAS = 7;

// Numeração sequencial para listas exibidas ao paciente
const numItem = (i) => `${i + 1}.`;

/** Normaliza string: minúsculas, sem acentos, trimmed. */
function normalizar(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * Resolve a resposta do paciente à pergunta "Particular ou Convênio?".
 * Aceita números, emoji numbers e variantes textuais comuns.
 * @returns {'particular'|'convenio'|null}
 */
function parseEscolhaTipoConsulta(msg) {
  const trimmed = String(msg ?? '').trim();
  if (trimmed === '1' || trimmed === '1️⃣') return 'particular';
  if (trimmed === '2' || trimmed === '2️⃣') return 'convenio';
  const n = normalizar(msg);
  if (n === 'particular' || n === 'part' || n === 'particular.') return 'particular';
  if (n === 'convenio' || n === 'plano' || n === 'pelo plano' || n === 'pelo convenio' || n === 'convenio.') return 'convenio';
  return null;
}

/**
 * Tenta resolver a mensagem do paciente para um plano de saúde da lista oficial.
 * Estratégia: número/emoji number → match exato → match parcial (substring).
 * @returns {object|null} - convênio encontrado ou null
 */
function matchPlano(msg, conveniosAtivos) {
  const trimmed = String(msg ?? '').trim();
  if (!trimmed || conveniosAtivos.length === 0) return null;

  // Número simples (1, 2, …)
  for (let i = 0; i < conveniosAtivos.length; i++) {
    if (trimmed === String(i + 1)) {
      return conveniosAtivos[i];
    }
  }

  const n = normalizar(msg);
  if (!n) return null;

  // Match exato
  for (const c of conveniosAtivos) {
    if (normalizar(c.nome) === n) return c;
  }

  // Match parcial: nome do plano contém a mensagem OU mensagem contém nome do plano
  // Mínimo de 3 caracteres para evitar false positives ("a" matchando "Caixa")
  if (n.length < 3) return null;
  for (const c of conveniosAtivos) {
    const cn = normalizar(c.nome);
    if (cn.includes(n) || n.includes(cn)) return c;
  }
  return null;
}

/** Lista numerada de profissionais para o paciente (sem UUID). */
function formatarListaProfissionaisVisivel(profissionais) {
  return profissionais
    .map((p, i) => `${numItem(i)} ${p.nome} — ${p.especialidade} (${p.duracaoConsultaMin} min)`)
    .join('\n');
}

/** Lista numerada de planos de saúde para o paciente. */
function formatarListaPlanos(conveniosAtivos) {
  return conveniosAtivos
    .map((c, i) => `${numItem(i)} ${c.nome}`)
    .join('\n');
}

/**
 * Aplica a transição determinística para o estado escolhendo_especialidade
 * após o paciente escolher tipo de consulta (particular ou convênio).
 * Atualiza o estado no banco e retorna a mensagem com a lista filtrada de profissionais.
 *
 * Caso especial: se só houver 1 profissional disponível, pula a etapa de seleção
 * e vai direto para escolhendo_horario, listando os horários do único médico.
 */
async function transicionarParaEspecialidade(clinicaId, telefone, contextoAtual, profissionaisFiltrados, tipoConsulta, convenioNome) {
  const novoContexto = {
    ...contextoAtual,
    tipo_consulta: tipoConsulta,
    convenio_nome: tipoConsulta === 'convenio' ? convenioNome : null,
  };

  if (profissionaisFiltrados.length === 0) {
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'escolhendo_especialidade', contextoJson: novoContexto },
    });
    return tipoConsulta === 'convenio'
      ? `Infelizmente, no momento, nenhum profissional atende ${convenioNome}. Deseja agendar como particular? 🙏`
      : 'No momento não temos profissionais disponíveis para atendimento particular. Por favor, entre em contato com a recepção.';
  }

  const tituloTipo = tipoConsulta === 'convenio' ? `Convênio ${convenioNome}` : 'Particular';

  // Único profissional disponível: pula a seleção e vai direto para horários.
  if (profissionaisFiltrados.length === 1) {
    const profUnico = profissionaisFiltrados[0];
    const contextoComProf = { ...novoContexto, profissional_id: profUnico.id };

    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'escolhendo_horario', contextoJson: contextoComProf },
    });

    const agora = new Date();
    const dataFim = new Date(agora.getTime() + JANELA_SLOTS_DIAS * 24 * 60 * 60 * 1000);
    const slots = await getCalendarSlots(clinicaId, profUnico.id, agora, dataFim);
    const slotsMsg = formatarSlotsParaMensagem([{ profissional: profUnico, slots }], profUnico.id);

    return `Ótimo! ${tituloTipo}. Vou te encaixar com ${profUnico.nome} (${profUnico.especialidade}). 😊\n\nEstes são os horários disponíveis:\n\n${slotsMsg}\n\nPor favor, escolha um horário para a consulta.`;
  }

  await prisma.estadoConversa.update({
    where: { telefone_clinicaId: { telefone, clinicaId } },
    data: { estado: 'escolhendo_especialidade', contextoJson: novoContexto },
  });

  return `Ótimo! ${tituloTipo}. Temos os seguintes profissionais disponíveis — digite o número para escolher: 😊\n\n${formatarListaProfissionaisVisivel(profissionaisFiltrados)}`;
}

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
 * Remove blocos de listagem de horários (linhas começando com 📅 + a linha de slots
 * imediatamente seguinte) que o LLM tenha incluído por reflexo. Usado quando o
 * paciente já escolheu horário (data_hora preenchido) e a próxima pergunta é o
 * nome — calendário ali confunde e suja a mensagem.
 * @param {string} text
 * @returns {string}
 */
function removerListagemHorarios(text) {
  if (!text) return text;
  // Linha "📅 ...:" seguida de uma linha de slots; consome opcionalmente uma
  // linha em branco depois. Repetições agrupadas para limpar múltiplos dias.
  return text
    .replace(/(?:📅[^\n]*\n[^\n]*\n?\n?)+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Formata os slots disponíveis de um profissional para exibição no chat.
 * Retorna string pronta para enviar ao paciente ou mensagem de fallback.
 * @param {Array} horariosDisponiveis - Resultado de getAvailableSlots
 * @param {string} profissionalId
 * @returns {string}
 */
function formatarSlotsParaMensagem(horariosDisponiveis, profissionalId) {
  const entrada = horariosDisponiveis.find((h) => h.profissional.id === profissionalId);
  const dias = entrada?.slots ?? [];
  if (dias.length === 0) return 'Sem horários disponíveis no momento. Entre em contato com a recepção.';

  return dias
    .slice(0, 3)
    .map((d) => {
      const [ano, mes, dia] = d.data.split('-');
      return `📅 ${d.dia_semana}, ${dia}/${mes}/${ano}:\n${d.slots.slice(0, 8).join(' | ')}`;
    })
    .join('\n\n');
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
  // Trata a string "null" como null real (GPT-4o-mini às vezes retorna a string "null")
  const novoContexto = { ...contextoAnterior };
  for (const [chave, valor] of Object.entries(dadosExtraidos ?? {})) {
    if (valor !== null && valor !== undefined && valor !== 'null') {
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
 * Quando tipo_consulta = "convenio", convenio_nome também é obrigatório.
 * @param {object} contexto
 * @param {boolean} temConvenios - Se a clínica possui convênios ativos
 * @returns {boolean}
 */
function dadosAgendamentoCompletos(contexto, temConvenios = false) {
  const basico = Boolean(
    contexto.profissional_id &&
    contexto.data_hora &&
    contexto.nome_paciente
  );
  if (!basico) return false;

  // Se a clínica tem convênios, o tipo de consulta deve estar definido
  if (temConvenios && !contexto.tipo_consulta) return false;

  // Se for convênio, o nome do convênio também é obrigatório
  if (contexto.tipo_consulta === 'convenio' && !contexto.convenio_nome) return false;

  return true;
}

/**
 * Cria o registro de agendamento no banco e atualiza o paciente com o nome coletado.
 *
 * @param {string} clinicaId
 * @param {object} paciente
 * @param {object} contexto - Contexto acumulado com dados_extraidos
 * @param {object} profissional - Profissional correspondente ao profissional_id
 * @param {Array} conveniosClinica - Lista de convênios ativos da clínica (para resolver convenioId)
 */
async function criarAgendamento(clinicaId, paciente, contexto, profissional, conveniosClinica = []) {
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

  // Resolve convenioId a partir do nome informado pelo paciente
  let convenioId = null;
  if (contexto.tipo_consulta === 'convenio' && contexto.convenio_nome) {
    const convenioEncontrado = conveniosClinica.find(
      (c) => c.nome.toLowerCase() === contexto.convenio_nome.toLowerCase()
    );
    convenioId = convenioEncontrado?.id ?? null;
    if (!convenioId) {
      console.warn(`[criarAgendamento] convênio não encontrado: "${contexto.convenio_nome}"`);
    }
  }

  const tipoConsulta = contexto.tipo_consulta === 'convenio' ? 'convenio' : 'particular';

  const agendamento = await prisma.agendamento.create({
    data: {
      clinicaId,
      profissionalId: contexto.profissional_id,
      pacienteId: pacienteParaAgendar.id,
      dataHora: new Date(contexto.data_hora),
      duracaoMin: profissional?.duracaoConsultaMin ?? 30,
      status: 'agendado',
      tipoConsulta,
      convenioId,
      // calendarEventId é preenchido logo após a criação do evento no Google Calendar
    },
  });

  console.log(`✅ Agendamento criado: id=${agendamento.id} para ${nomePaciente} (paciente ${pacienteParaAgendar.id})`);
  return agendamento;
}

/**
 * Interpreta a resposta do paciente ao lembrete automático (estado aguardando_resposta_lembrete).
 * Não usa IA — interpreta diretamente a opção escolhida no menu numerado.
 */
async function handleRespostaLembrete(clinicaId, telefone, mensagemTexto, contexto, paciente, pacientesDoTelefone) {
  const msg = mensagemTexto.trim().toLowerCase();
  const agendamentoId = contexto.agendamento_id;

  // Opção 1 — confirmar presença
  if (['1', 'sim', 'confirmo', 'confirmar'].includes(msg)) {
    if (agendamentoId) {
      const ag = await prisma.agendamento.update({
        where: { id: agendamentoId },
        data: { status: 'confirmado', confirmedBy: 'paciente' },
        select: { clinicaId: true, profissionalId: true, calendarEventId: true, paciente: { select: { nome: true } } },
      });
      if (ag.calendarEventId) {
        const nomePaciente = ag.paciente?.nome ?? 'Paciente';
        await patchEventTitle(ag.clinicaId, ag.profissionalId, ag.calendarEventId, `✅ Confirmado pelo paciente: ${nomePaciente}`);
      }
    }
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'inicio', contextoJson: {} },
    });
    return 'Ótimo! Presença confirmada. Te esperamos. 😊';
  }

  // Opção 2 — remarcar
  if (['2', 'remarcar'].includes(msg)) {
    let profissionalId = null;
    if (agendamentoId) {
      const agendamento = await prisma.agendamento.findUnique({
        where: { id: agendamentoId },
        select: { profissionalId: true },
      });
      profissionalId = agendamento?.profissionalId ?? null;
    }

    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: {
        estado: 'escolhendo_horario',
        contextoJson: { agendamento_id: agendamentoId, profissional_id: profissionalId },
      },
    });

    // Busca slots disponíveis para o profissional
    if (profissionalId) {
      const agora = new Date();
      const dataFim = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);
      const slots = await getCalendarSlots(clinicaId, profissionalId, agora, dataFim);
      const profissional = await prisma.profissional.findUnique({ where: { id: profissionalId } });
      const slotsMsg = formatarSlotsParaMensagem([{ profissional, slots }], profissionalId);
      return `Tudo bem! Aqui estão os horários disponíveis:\n\n${slotsMsg}`;
    }

    return 'Tudo bem! Me diga o novo dia e horário que você prefere. 📅';
  }

  // Opção 3 — cancelar
  if (['3', 'cancelar'].includes(msg)) {
    let cancelado = false;
    if (agendamentoId) {
      const agendamento = await prisma.agendamento.findFirst({
        where: { id: agendamentoId, clinicaId, status: 'confirmado' },
      });

      if (agendamento) {
        await prisma.agendamento.update({
          where: { id: agendamento.id },
          data: { status: 'cancelado' },
        });
        if (agendamento.calendarEventId) {
          try {
            await deleteEvent(clinicaId, agendamento.profissionalId, agendamento.calendarEventId);
          } catch (err) {
            console.error(`[handleRespostaLembrete] erro ao deletar evento Calendar: ${err.message}`);
          }
        }
        await cancelReminder(agendamento.id);
        cancelado = true;
        console.log(`✅ [handleRespostaLembrete] agendamento ${agendamento.id} cancelado via resposta ao lembrete`);
      }
    }

    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'inicio', contextoJson: {} },
    });

    return cancelado
      ? 'Consulta cancelada com sucesso. Se quiser reagendar, é só falar comigo! 😊'
      : 'Não encontrei sua consulta para cancelar. Entre em contato com a recepção se precisar de ajuda.';
  }

  // Resposta não reconhecida
  return 'Desculpe, não entendi. Responda com 1, 2 ou 3.';
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

  // 2a. Tratamento do estado aguardando_resposta_lembrete — interpreta diretamente sem chamar IA
  if (estadoConversa.estado === 'aguardando_resposta_lembrete') {
    return handleRespostaLembrete(clinicaId, telefone, mensagemTexto, estadoConversa.contextoJson ?? {}, paciente, pacientesDoTelefone);
  }

  // 2b. Estado concluido — reseta para inicio para o Claude não arrastar contexto da marcação anterior
  if (estadoConversa.estado === 'concluido') {
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'inicio', contextoJson: {} },
    });
    estadoConversa.estado = 'inicio';
    estadoConversa.contextoJson = {};
  }

  // 3. Busca o histórico recente (últimas N mensagens em ordem cronológica)
  const historico = (await prisma.conversa.findMany({
    where: { clinicaId, telefone },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY,
  })).reverse();

  // 4. Busca profissionais ativos da clínica (com convênios vinculados)
  const profissionaisRaw = await prisma.profissional.findMany({
    where: { clinicaId, ativo: true },
    orderBy: { nome: 'asc' },
    include: {
      convenios: {
        include: { convenio: { select: { id: true, nome: true, ativo: true } } },
      },
    },
  });
  // Flatten convenios para cada profissional
  const profissionais = profissionaisRaw.map((p) => ({
    ...p,
    convenios: p.convenios.map((pc) => pc.convenio),
  }));

  // 4a. Busca convênios ativos da clínica (para o system prompt e validações)
  const conveniosClinica = await prisma.convenio.findMany({
    where: { clinicaId, ativo: true },
    orderBy: { nome: 'asc' },
  });
  const temConveniosNaClinica = conveniosClinica.length > 0;

  // 4b. Convênios com pelo menos um profissional vinculado — só estes são oferecidos ao paciente.
  const conveniosAtivosComProf = conveniosClinica.filter((c) =>
    profissionais.some((p) => (p.convenios ?? []).some((cv) => cv.id === c.id))
  );

  // 4c. Interceptação determinística do fluxo de convênio.
  // Para os estados escolhendo_convenio (tipo de consulta) e escolhendo_plano (qual plano),
  // resolvemos a entrada em código — sem chamar o LLM. Isso elimina três classes de bug
  // (resolução numérica, match parcial, filtragem de profissionais por convênio) e
  // encolhe o prompt em ~700 tokens. Casos não cobertos caem no LLM normalmente.
  if (estadoConversa.estado === 'escolhendo_convenio' && conveniosAtivosComProf.length > 0) {
    const escolha = parseEscolhaTipoConsulta(mensagemTexto);
    if (escolha === 'particular') {
      const profsParticular = profissionais.filter((p) => p.atendeParticular !== false);
      return await transicionarParaEspecialidade(
        clinicaId, telefone, estadoConversa.contextoJson ?? {}, profsParticular, 'particular', null
      );
    }
    if (escolha === 'convenio') {
      const novoContexto = { ...(estadoConversa.contextoJson ?? {}) };
      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'escolhendo_plano', contextoJson: novoContexto },
      });
      return `Qual o seu plano de saúde? 😊 Digite o número ou o nome do plano:\n${formatarListaPlanos(conveniosAtivosComProf)}`;
    }
    // Sem match → cai no LLM (entrada livre como "ainda não sei", etc.)
  }

  if (estadoConversa.estado === 'escolhendo_plano' && conveniosAtivosComProf.length > 0) {
    // Tenta resolver para um plano PRIMEIRO — números (1, 2, …) e emoji numbers se referem
    // à lista de planos exibida; tratá-los como "particular" estaria errado neste estado.
    const planoMatch = matchPlano(mensagemTexto, conveniosAtivosComProf);
    if (planoMatch) {
      const profsDoPlano = profissionais.filter((p) =>
        (p.convenios ?? []).some((c) => c.id === planoMatch.id)
      );
      return await transicionarParaEspecialidade(
        clinicaId, telefone, estadoConversa.contextoJson ?? {}, profsDoPlano, 'convenio', planoMatch.nome
      );
    }

    // Permite mudar de ideia: paciente digita a PALAVRA "particular" / "part".
    // Só aceita texto (não número) — números já foram considerados acima como índice de plano.
    const normalizada = normalizar(mensagemTexto);
    if (normalizada === 'particular' || normalizada === 'part' || normalizada === 'particular.') {
      const profsParticular = profissionais.filter((p) => p.atendeParticular !== false);
      return await transicionarParaEspecialidade(
        clinicaId, telefone, estadoConversa.contextoJson ?? {}, profsParticular, 'particular', null
      );
    }

    // Não bateu — re-pergunta com a lista, sem cair no LLM (texto fixo)
    return `Não entendi. Digite o número ou o nome do plano:\n${formatarListaPlanos(conveniosAtivosComProf)}`;
  }

  // 5. Obtém horários disponíveis via Google Calendar (com fallback para mock)
  const horariosDisponiveis = await getAvailableSlots(clinicaId, profissionais);

  // 6. Monta o system prompt com todo o contexto
  const systemPrompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, nomesConhecidos, agendamentosAtivos, conveniosClinica);

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

  // 8b. Contador de mensagens incompreensíveis — escala para recepção após 3 seguidas
  const intentosUteis = ['agendar', 'remarcar', 'cancelar', 'saudacao'];
  const isIncompreensivel = controle.acao === 'nenhuma' && !intentosUteis.includes(controle.intencao);
  const contagemAnterior = estadoConversa.contextoJson?.tentativas_sem_entendimento ?? 0;
  const novaContagem = isIncompreensivel ? contagemAnterior + 1 : 0;
  console.log(`[fallback] intencao=${controle.intencao} acao=${controle.acao} isIncompreensivel=${isIncompreensivel} contagem=${contagemAnterior}→${novaContagem}`);

  if (novaContagem !== contagemAnterior) {
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { contextoJson: { ...contextoAtualizado, tentativas_sem_entendimento: novaContagem } },
    });
  }

  if (novaContagem >= 3) {
    await prisma.estadoConversa.update({
      where: { telefone_clinicaId: { telefone, clinicaId } },
      data: { estado: 'inicio', contextoJson: {} },
    });
    const telefoneFallback = clinica.configJson?.telefone_fallback || clinica.telefone || '';
    return telefoneFallback
      ? `Não estou conseguindo entender sua solicitação. Para atendimento, ligue para ${telefoneFallback}. 🙏`
      : 'Não estou conseguindo entender sua solicitação. Entre em contato com nossa recepção pelo telefone da clínica. 🙏';
  }

  // 8c. Normaliza a ação: se há sinal de remarcação e dados completos, força remarcar_agendamento
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

  // 8c-bis. Interceptação determinística da pergunta de nome do paciente.
  // O LLM ignora a instrução de omitir o calendário nesse turno e às vezes
  // nem retorna novo_estado='confirmando' nem data_hora no JSON.
  // Três gatilhos (qualquer um basta):
  //   (a) novo_estado === 'confirmando'
  //   (b) estávamos em escolhendo_horario e LLM mudou de estado
  //   (c) estávamos em escolhendo_horario e o texto contém "Para finalizar"
  //       ou "para quem" — sinal textual mais confiável que o JSON neste caso
  const llmPediuNome =
    estadoConversa.estado === 'escolhendo_horario' && (
      controle.novo_estado !== 'escolhendo_horario' ||
      respostaFinal.includes('Para finalizar') ||
      respostaFinal.toLowerCase().includes('para quem')
    );
  const devePerguntarNome = !contextoAtualizado.nome_paciente && (
    controle.novo_estado === 'confirmando' || llmPediuNome
  );
  console.log(`[8c-bis] prevState=${estadoConversa.estado} novoEstado=${controle.novo_estado} data_hora=${contextoAtualizado.data_hora} llmPediuNome=${llmPediuNome} devePerguntarNome=${devePerguntarNome}`);
  if (devePerguntarNome) {
    const listaFormatada = nomesConhecidos.length > 0
      ? nomesConhecidos.map((n) => `• ${n}`).join('\n')
      : null;
    respostaFinal = listaFormatada
      ? `Para finalizar, essa consulta é para:\n\n${listaFormatada}\n\nOu está agendando para outra pessoa?`
      : 'Para finalizar, qual o seu nome completo?';
    console.log('[8c-bis] pergunta de nome gerada deterministicamente');
  } else if (contextoAtualizado.data_hora) {
    respostaFinal = removerListagemHorarios(respostaFinal);
  }

  // 8d. Garante exibição dos horários ao transitar para escolhendo_horario.
  // O modelo às vezes apenas ecoa o nome do profissional sem listar os slots.
  // Não injeta se devePerguntarNome=true: o GPT-4o-mini retorna novo_estado='escolhendo_horario'
  // mesmo quando pede o nome, e sem essa guarda o calendário seria colado após a mensagem de nome.
  if (
    !devePerguntarNome &&
    controle.novo_estado === 'escolhendo_horario' &&
    contextoAtualizado.profissional_id &&
    !contextoAtualizado.data_hora &&
    !respostaFinal.includes('📅')
  ) {
    const slotsFormatados = formatarSlotsParaMensagem(horariosDisponiveis, contextoAtualizado.profissional_id);
    respostaFinal = `${respostaFinal}\n\n${slotsFormatados}`;
    console.log(`[slots] horários injetados pelo código para profissional ${contextoAtualizado.profissional_id}`);
  }

  if (acaoEfetiva === 'criar_agendamento' && dadosAgendamentoCompletos(contextoAtualizado, temConveniosNaClinica)) {
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
      const slotsFormatados = formatarSlotsParaMensagem(horariosDisponiveis, profissional.id);
      respostaFinal =
        'Poxa, esse horário acabou de ser preenchido! 😕 Aqui estão outras opções disponíveis:\n\n' +
        slotsFormatados;
      return respostaFinal;
    }

    let agendamentoCriado = false;
    let agendamentoCriadoId = null;
    try {
      const agendamento = await criarAgendamento(clinicaId, paciente, contextoAtualizado, profissional, conveniosClinica);
      agendamentoCriado = true;
      agendamentoCriadoId = agendamento.id;

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
      // Agenda lembrete automático para todos
      if (agendamentoCriadoId) {
        await scheduleReminderIfNeeded(agendamentoCriadoId);
      }

      await prisma.estadoConversa.update({
        where: { telefone_clinicaId: { telefone, clinicaId } },
        data: { estado: 'concluido', contextoJson: {} },
      });
      respostaFinal = mensagemParaPaciente;
    } else {
      // Mantém o estado em confirmando para o paciente poder tentar de novo
      respostaFinal =
        'Desculpe, ocorreu um erro ao registrar o agendamento. ' +
        'Por favor, tente confirmar novamente ou entre em contato com a recepção. 🙏';
    }

  } else if (acaoEfetiva === 'remarcar_agendamento' && dadosAgendamentoCompletos(contextoAtualizado, temConveniosNaClinica)) {
    // Ponto 2: log do contexto ao entrar no fluxo de remarcação
    console.log(`[remarcar_agendamento] contexto=${JSON.stringify(contextoAtualizado)}`);

    const profissional = profissionais.find((p) => p.id === contextoAtualizado.profissional_id);

    if (!profissional) {
      console.error(`[remarcar_agendamento] profissional_id inválido: "${contextoAtualizado.profissional_id}"`);
      respostaFinal = 'Desculpe, tive um problema ao identificar o profissional. Pode me dizer novamente qual consulta deseja remarcar? 🙏';
      return respostaFinal;
    }

    const duracaoMin = profissional.duracaoConsultaMin;

    // Localiza o agendamento original — cadeia de precisão decrescente:
    // 1. Por agendamento_id exato
    // 2. Por profissional_id + data_hora da consulta ANTIGA (contexto anterior ao novo horário)
    // 3. Por profissional_id (qualquer confirmado futuro deste profissional/telefone)
    let agendamentoAntigo = null;
    if (contextoAtualizado.agendamento_id) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: { id: contextoAtualizado.agendamento_id, clinicaId },
      });
      console.log(`[remarcar_agendamento] por agendamento_id=${contextoAtualizado.agendamento_id}: ${agendamentoAntigo ? 'encontrado' : 'não encontrado'}`);
    }
    if (!agendamentoAntigo) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: {
          clinicaId,
          profissionalId: profissional.id,
          pacienteId: { in: pacientesDoTelefone.map((p) => p.id) },
          status: 'confirmado',
          dataHora: { gte: new Date() },
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
      const slotsFormatados = formatarSlotsParaMensagem(horariosDisponiveis, profissional.id);
      respostaFinal =
        'Poxa, esse horário acabou de ser preenchido! 😕 Aqui estão outras opções disponíveis:\n\n' +
        slotsFormatados;
      return respostaFinal;
    }

    // Ponto 4: cria novo agendamento e só confirma sucesso após banco + Calendar OK
    let remarcacaoConcluida = false;
    let novoAgendamentoId = null;
    try {
      const novoAgendamento = await criarAgendamento(clinicaId, paciente, contextoAtualizado, profissional, conveniosClinica);
      console.log(`✅ [remarcar_agendamento] novo agendamento criado: ${novoAgendamento.id}`);
      remarcacaoConcluida = true;
      novoAgendamentoId = novoAgendamento.id;

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

      // Cancela lembrete do agendamento anterior e agenda para o novo
      if (agendamentoAntigo) {
        await cancelReminder(agendamentoAntigo.id);
      }
      if (novoAgendamentoId) {
        await scheduleReminderIfNeeded(novoAgendamentoId);
      }

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

    // Localiza o agendamento a cancelar — cadeia de precisão decrescente:
    // 1. Por agendamento_id exato
    // 2. Por profissional_id + data_hora exata (mais preciso quando ID não veio)
    // 3. Por profissional_id (qualquer confirmado deste profissional/telefone)
    // Sem fallback genérico "qualquer agendamento" — risco de cancelar o errado
    let agendamentoAntigo = null;
    if (contextoAtualizado.agendamento_id) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: { id: contextoAtualizado.agendamento_id, clinicaId },
      });
      console.log(`[cancelar_agendamento] por agendamento_id=${contextoAtualizado.agendamento_id}: ${agendamentoAntigo ? 'encontrado' : 'não encontrado'}`);
    }
    if (!agendamentoAntigo && contextoAtualizado.profissional_id && contextoAtualizado.data_hora) {
      const dataHoraExata = new Date(contextoAtualizado.data_hora);
      if (!isNaN(dataHoraExata.getTime())) {
        agendamentoAntigo = await prisma.agendamento.findFirst({
          where: {
            clinicaId,
            profissionalId: contextoAtualizado.profissional_id,
            pacienteId: { in: pacientesDoTelefone.map((p) => p.id) },
            status: 'confirmado',
            dataHora: dataHoraExata,
          },
        });
        console.log(`[cancelar_agendamento] por profissional+dataHora (${contextoAtualizado.data_hora}): ${agendamentoAntigo ? agendamentoAntigo.id : 'não encontrado'}`);
      }
    }
    if (!agendamentoAntigo && contextoAtualizado.profissional_id) {
      agendamentoAntigo = await prisma.agendamento.findFirst({
        where: {
          clinicaId,
          profissionalId: contextoAtualizado.profissional_id,
          pacienteId: { in: pacientesDoTelefone.map((p) => p.id) },
          status: 'confirmado',
          dataHora: { gte: new Date() },
        },
        orderBy: { dataHora: 'asc' },
      });
      console.log(`[cancelar_agendamento] por profissional (qualquer futuro): ${agendamentoAntigo ? agendamentoAntigo.id : 'não encontrado'}`);
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
      await cancelReminder(agendamentoAntigo.id);
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

  return respostaFinal;
}
