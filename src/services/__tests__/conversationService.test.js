import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('../../config/database.js', () => ({
  prisma: {
    paciente: {
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    estadoConversa: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    conversa: {
      findMany: vi.fn(),
    },
    profissional: {
      findMany:   vi.fn(),
      findUnique: vi.fn(), // usado pelo calendarService via conversationService
    },
    clinica: {
      findUnique: vi.fn(), // usado pelo calendarService para configJson
    },
    agendamento: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany:  vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../aiService.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt de teste'),
  processMessage: vi.fn(),
}));

vi.mock('../calendarService.js', () => ({
  getAvailableSlots: vi.fn().mockResolvedValue([
    { dia_semana: 'Segunda', data: '30/03', slots: ['08:00', '09:00'] },
  ]),
  createEvent:   vi.fn().mockResolvedValue('calendar-event-mock-id'),
  checkConflict: vi.fn().mockResolvedValue(false),
  deleteEvent:   vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../config/database.js';
import { processMessage } from '../aiService.js';
import { checkConflict, deleteEvent } from '../calendarService.js';
import { handleIncomingMessage } from '../conversationService.js';

// --- Fixtures ---

const CLINICA = {
  id: 'clinica-uuid-001',
  nome: 'Clínica Teste',
  endereco: 'Rua Teste, 123',
  telefoneWpp: '5561995535135',
  ativo: true,
};

const PACIENTE = {
  id: 'paciente-uuid-001',
  clinicaId: CLINICA.id,
  telefone: '5511999990001',
  nome: null,
};

const PROFISSIONAL = {
  id: 'prof-uuid-001',
  nome: 'Dr. João Silva',
  especialidade: 'Clínico Geral',
  duracaoConsultaMin: 30,
  ativo: true,
  clinicaId: CLINICA.id,
};

const AGENDAMENTO = {
  id: 'agendamento-uuid-001',
  clinicaId: CLINICA.id,
  profissionalId: PROFISSIONAL.id,
  pacienteId: PACIENTE.id,
  dataHora: new Date('2026-04-04T11:00:00.000Z'), // 08:00 BRT
  duracaoMin: 30,
  status: 'confirmado',
  calendarEventId: 'cal-event-001',
};

/** Monta um retorno padrão do processMessage */
function makeControle(overrides = {}) {
  return {
    mensagemParaPaciente: 'Resposta do bot',
    controle: {
      intencao: 'saudacao',
      novo_estado: 'inicio',
      dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
      acao: 'nenhuma',
      confianca: 0.9,
      ...overrides,
    },
  };
}

/** Configura o prisma para um estado específico da conversa */
function setupPrismaMocks({ estadoAtual = 'inicio', contextoJson = {} } = {}) {
  prisma.paciente.findFirst.mockResolvedValue(PACIENTE);
  prisma.paciente.findUnique.mockResolvedValue(PACIENTE);
  prisma.paciente.findMany.mockResolvedValue([PACIENTE]);
  prisma.paciente.create.mockResolvedValue(PACIENTE);
  prisma.paciente.update.mockResolvedValue({ ...PACIENTE, nome: 'Karen' });
  prisma.estadoConversa.findUnique.mockResolvedValue({
    id: 'estado-uuid-001',
    telefone: PACIENTE.telefone,
    clinicaId: CLINICA.id,
    estado: estadoAtual,
    contextoJson,
  });
  prisma.estadoConversa.create.mockResolvedValue({});
  prisma.estadoConversa.upsert.mockResolvedValue({});
  prisma.estadoConversa.update.mockResolvedValue({});
  prisma.conversa.findMany.mockResolvedValue([]);
  prisma.profissional.findMany.mockResolvedValue([PROFISSIONAL]);
  prisma.agendamento.findUnique.mockResolvedValue({ ...AGENDAMENTO, reminderJobId: null, paciente: { optInLembrete: false } });
  prisma.agendamento.findFirst.mockResolvedValue(AGENDAMENTO);
  prisma.agendamento.findMany.mockResolvedValue([]);
  prisma.agendamento.create.mockResolvedValue({ id: 'agendamento-uuid-001' });
  prisma.agendamento.update.mockResolvedValue({});
}

// =====================================================================
// TESTE 2 — Máquina de estados
// =====================================================================

describe('conversationService — handleIncomingMessage: máquina de estados', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('estado "inicio" + saudação → transita para "escolhendo_especialidade"', async () => {
    setupPrismaMocks({ estadoAtual: 'inicio' });
    processMessage.mockResolvedValueOnce(makeControle({ novo_estado: 'escolhendo_especialidade' }));

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Olá', CLINICA);

    expect(resposta).toBe('Resposta do bot');
    expect(prisma.estadoConversa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ estado: 'escolhendo_especialidade' }),
      })
    );
  });

  it('estado "escolhendo_especialidade" + escolha válida → transita para "escolhendo_horario"', async () => {
    setupPrismaMocks({ estadoAtual: 'escolhendo_especialidade' });
    processMessage.mockResolvedValueOnce(makeControle({
      novo_estado: 'escolhendo_horario',
      dados_extraidos: { especialidade: 'Clínico Geral', profissional_id: PROFISSIONAL.id, data_hora: null, nome_paciente: null },
    }));

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '1', CLINICA);

    expect(prisma.estadoConversa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ estado: 'escolhendo_horario' }),
      })
    );
  });

  it('estado "escolhendo_horario" + horário válido → transita para "confirmando"', async () => {
    setupPrismaMocks({
      estadoAtual: 'escolhendo_horario',
      contextoJson: { especialidade: 'Clínico Geral', profissional_id: PROFISSIONAL.id },
    });
    processMessage.mockResolvedValueOnce(makeControle({
      novo_estado: 'confirmando',
      dados_extraidos: { especialidade: null, profissional_id: null, data_hora: '2026-04-04T08:00:00-03:00', nome_paciente: null },
    }));

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sexta às 8h', CLINICA);

    expect(prisma.estadoConversa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ estado: 'confirmando' }),
      })
    );
  });

  it('estado "confirmando" + confirmação com nome → cria agendamento e volta para "inicio"', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-04-04T08:00:00-03:00',
        // nome_paciente virá via dados_extraidos abaixo
      },
    });
    processMessage.mockResolvedValueOnce(makeControle({
      novo_estado: 'concluido',
      acao: 'criar_agendamento',
      dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: 'Karen dos Santos' },
      confianca: 0.95,
    }));

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sim, Karen dos Santos', CLINICA);

    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
    expect(prisma.agendamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profissionalId: PROFISSIONAL.id,
          status: 'confirmado',
        }),
      })
    );
    // Após criar o agendamento, o sistema aguarda resposta de opt-in de lembrete
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'concluido',
          contextoJson: expect.objectContaining({ aguardando_opt_in: true }),
        }),
      })
    );
  });

  it('mensagem fora do escopo em qualquer estado → não muda o estado', async () => {
    setupPrismaMocks({ estadoAtual: 'escolhendo_especialidade' });
    processMessage.mockResolvedValueOnce(makeControle({
      novo_estado: 'escolhendo_especialidade', // Claude devolve o mesmo estado
      intencao: 'outro',
      confianca: 0.8,
    }));

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Aceita convênio?', CLINICA);

    expect(prisma.estadoConversa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ estado: 'escolhendo_especialidade' }),
      })
    );
    expect(prisma.agendamento.create).not.toHaveBeenCalled();
  });

  it('confiança baixa (<0.6) com estado "inicio" → retorna mensagem da IA sem sufixo de contato', async () => {
    // O sufixo "recepção" só é adicionado nos estados mid-flow (escolhendo_horario, confirmando),
    // não em "inicio" — evita poluir menus iniciais.
    setupPrismaMocks({ estadoAtual: 'inicio' });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Não entendi bem.',
      controle: {
        intencao: 'outro',
        novo_estado: 'inicio',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'nenhuma',
        confianca: 0.4,
      },
    });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Faz isso pra mim?', CLINICA);

    expect(resposta).toContain('Não entendi bem.');
  });

  it('cria paciente automaticamente se não existir no banco', async () => {
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.paciente.findFirst.mockResolvedValueOnce(null); // paciente não existe
    processMessage.mockResolvedValueOnce(makeControle({ novo_estado: 'escolhendo_especialidade' }));

    await handleIncomingMessage(CLINICA.id, '5511888880002', 'Oi', CLINICA);

    expect(prisma.paciente.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clinicaId: CLINICA.id, telefone: '5511888880002' }),
      })
    );
  });

  it('não cria agendamento quando acao é "criar_agendamento" mas dados estão incompletos', async () => {
    setupPrismaMocks({ estadoAtual: 'confirmando', contextoJson: {} }); // contexto vazio — sem profissional_id nem data_hora
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Qual horário deseja?',
      controle: {
        intencao: 'agendar',
        novo_estado: 'escolhendo_horario',
        dados_extraidos: { especialidade: 'Dermatologia', profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'criar_agendamento', // Claude enviou mas dados não estão completos
        confianca: 0.7,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'sim', CLINICA);

    expect(prisma.agendamento.create).not.toHaveBeenCalled();
  });
});

// Contexto base reutilizado nos testes de remarcar/cancelar
const CONTEXTO_REMARCAR = {
  profissional_id: PROFISSIONAL.id,
  data_hora: '2026-04-11T12:00:00.000Z',
  nome_paciente: 'Karen dos Santos',
  agendamento_id: AGENDAMENTO.id,
};

// =====================================================================
// TESTE 3 — remarcar_agendamento
// =====================================================================

describe('conversationService — handleIncomingMessage: remarcar_agendamento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encontra agendamento por ID → cancela antigo (com Calendar), cria novo, reseta estado', async () => {
    setupPrismaMocks({ estadoAtual: 'confirmando', contextoJson: CONTEXTO_REMARCAR });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Consulta remarcada com sucesso!',
      controle: {
        intencao: 'remarcar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'remarcar_agendamento',
        confianca: 0.95,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Quero remarcar para sexta às 9h', CLINICA);

    // Agendamento antigo marcado como cancelado
    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: AGENDAMENTO.id },
        data: { status: 'cancelado' },
      })
    );
    // Evento removido do Google Calendar
    expect(deleteEvent).toHaveBeenCalledWith(CLINICA.id, PROFISSIONAL.id, AGENDAMENTO.calendarEventId);
    // Novo agendamento criado
    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
    // Estado resetado
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio', contextoJson: {} }),
      })
    );
  });

  it('usa fallback por profissional quando sem agendamento_id → cancela e cria', async () => {
    const contextoSemId = { ...CONTEXTO_REMARCAR };
    delete contextoSemId.agendamento_id;
    setupPrismaMocks({ estadoAtual: 'confirmando', contextoJson: contextoSemId });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Remarcado!',
      controle: {
        intencao: 'remarcar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'remarcar_agendamento',
        confianca: 0.9,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Para sexta', CLINICA);

    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
  });

  it('sem agendamento anterior → cria novo sem tentar cancelar', async () => {
    const contextoSemId = { ...CONTEXTO_REMARCAR };
    delete contextoSemId.agendamento_id;
    setupPrismaMocks({ estadoAtual: 'confirmando', contextoJson: contextoSemId });
    prisma.agendamento.findFirst.mockResolvedValue(null); // nenhum agendamento encontrado
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Agendado!',
      controle: {
        intencao: 'remarcar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'remarcar_agendamento',
        confianca: 0.9,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Para sexta', CLINICA);

    // Não tentou cancelar nada
    expect(prisma.agendamento.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    // Mas criou o novo agendamento
    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
  });

  it('conflito no novo horário → não cria agendamento, volta para escolhendo_horario', async () => {
    setupPrismaMocks({ estadoAtual: 'confirmando', contextoJson: CONTEXTO_REMARCAR });
    checkConflict.mockResolvedValueOnce(true);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Confirma para sexta às 9h?',
      controle: {
        intencao: 'remarcar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'remarcar_agendamento',
        confianca: 0.9,
      },
    });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sexta às 9h', CLINICA);

    expect(resposta).toContain('preenchido');
    expect(prisma.agendamento.create).not.toHaveBeenCalled();
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'escolhendo_horario' }),
      })
    );
  });

  it('normaliza criar_agendamento → remarcar quando agendamento_id está no contexto', async () => {
    setupPrismaMocks({ estadoAtual: 'confirmando', contextoJson: CONTEXTO_REMARCAR });
    // Claude retornou criar_agendamento, mas deve ser normalizado para remarcar
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Remarcado com sucesso!',
      controle: {
        intencao: 'saudacao', // intencao qualquer — a normalização é pelo agendamento_id
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'criar_agendamento', // será normalizado
        confianca: 0.9,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sim, pode ser', CLINICA);

    // Comportamento de remarcação: cancela o antigo e cria o novo
    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
  });
});

// =====================================================================
// TESTE 4 — cancelar_agendamento
// =====================================================================

describe('conversationService — handleIncomingMessage: cancelar_agendamento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancela por agendamento_id, remove evento do Calendar e reseta estado', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: { agendamento_id: AGENDAMENTO.id },
    });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Consulta cancelada com sucesso!',
      controle: {
        intencao: 'cancelar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'cancelar_agendamento',
        confianca: 0.95,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Quero cancelar minha consulta', CLINICA);

    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: AGENDAMENTO.id },
        data: { status: 'cancelado' },
      })
    );
    expect(deleteEvent).toHaveBeenCalledWith(CLINICA.id, PROFISSIONAL.id, AGENDAMENTO.calendarEventId);
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio', contextoJson: {} }),
      })
    );
  });

  it('localiza agendamento por profissional+dataHora quando sem agendamento_id', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: AGENDAMENTO.dataHora.toISOString(),
        // sem agendamento_id
      },
    });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Consulta cancelada!',
      controle: {
        intencao: 'cancelar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'cancelar_agendamento',
        confianca: 0.9,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Cancelar consulta', CLINICA);

    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio' }),
      })
    );
  });

  it('usa fallback por profissional quando sem agendamento_id e sem data_hora', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: { profissional_id: PROFISSIONAL.id },
    });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Cancelado!',
      controle: {
        intencao: 'cancelar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'cancelar_agendamento',
        confianca: 0.9,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Cancela minha consulta com Dr. João', CLINICA);

    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio' }),
      })
    );
  });

  it('agendamento sem calendarEventId → cancela no banco sem chamar deleteEvent', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: { agendamento_id: AGENDAMENTO.id },
    });
    prisma.agendamento.findFirst.mockResolvedValue({ ...AGENDAMENTO, calendarEventId: null });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Cancelado!',
      controle: {
        intencao: 'cancelar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'cancelar_agendamento',
        confianca: 0.9,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Cancelar', CLINICA);

    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('nenhum agendamento encontrado → retorna mensagem de erro, não reseta estado', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: { agendamento_id: AGENDAMENTO.id },
    });
    prisma.agendamento.findFirst.mockResolvedValue(null);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Cancelando...',
      controle: {
        intencao: 'cancelar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
        acao: 'cancelar_agendamento',
        confianca: 0.9,
      },
    });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Cancelar', CLINICA);

    expect(resposta).toContain('não consegui localizar');
    expect(prisma.agendamento.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    // Estado não foi resetado para 'inicio' (update com inicio não chamado)
    expect(prisma.estadoConversa.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio' }),
      })
    );
  });
});
