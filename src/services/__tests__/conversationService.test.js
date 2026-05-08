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
    convenio: {
      findMany: vi.fn(),
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
  atendeParticular: true,
  ativo: true,
  clinicaId: CLINICA.id,
  convenios: [], // sem convênios por padrão nos testes base
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
  // profissional.findMany retorna com a relação `convenios` que o código faz include
  prisma.profissional.findMany.mockResolvedValue([
    { ...PROFISSIONAL, convenios: [] },
  ]);
  // clínica sem convênios por padrão — mantém retrocompatibilidade
  prisma.convenio.findMany.mockResolvedValue([]);
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
          status: 'agendado',
          tipoConsulta: 'particular', // clínica sem convênios → particular por padrão
        }),
      })
    );
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'concluido',
        }),
      })
    );
  });

  it('paciente já tem data_hora + LLM inclui calendário no texto → calendário é removido da resposta', async () => {
    setupPrismaMocks({
      estadoAtual: 'escolhendo_horario',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-05-05T11:00:00-03:00',
      },
    });
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente:
        'Ótimo! Para finalizar, qual o seu nome completo?\n\n📅 Segunda, 04/05/2026:\n08:00 | 08:40 | 09:20\n\n📅 Terça, 05/05/2026:\n08:40 | 09:20 | 10:00',
      controle: {
        intencao: 'agendar',
        novo_estado: 'escolhendo_horario',
        dados_extraidos: { especialidade: null, profissional_id: null, tipo_consulta: null, convenio_nome: null, data_hora: null, nome_paciente: null, agendamento_id: null },
        acao: 'nenhuma',
        confianca: 0.9,
      },
    });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'terça 8h', CLINICA);

    expect(resposta).toContain('Para finalizar');
    expect(resposta).not.toContain('📅');
    expect(resposta).not.toContain('08:00 | 08:40');
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

// =====================================================================
// TESTE 5 — Particular vs Convênio
// =====================================================================

const CONVENIO_AMIL = { id: 'convenio-uuid-amil', clinicaId: CLINICA.id, nome: 'Amil', ativo: true };
const CONVENIO_UNIMED = { id: 'convenio-uuid-unimed', clinicaId: CLINICA.id, nome: 'Unimed', ativo: true };

const PROFISSIONAL_COM_CONVENIO = {
  ...PROFISSIONAL,
  convenios: [{ convenioId: CONVENIO_AMIL.id, convenio: CONVENIO_AMIL }],
};

describe('conversationService — handleIncomingMessage: particular vs convênio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clínica sem convênios → cria agendamento com tipoConsulta="particular" sem perguntar', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-05-10T10:00:00-03:00',
        nome_paciente: 'Carlos Silva',
      },
    });
    // convenio.findMany retorna vazio → clínica sem convênios
    prisma.convenio.findMany.mockResolvedValue([]);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Consulta agendada!',
      controle: {
        intencao: 'agendar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, tipo_consulta: null, convenio_nome: null, data_hora: null, nome_paciente: null, agendamento_id: null },
        acao: 'criar_agendamento',
        confianca: 0.95,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sim, confirmo', CLINICA);

    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
    expect(prisma.agendamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoConsulta: 'particular',
          convenioId: null,
        }),
      })
    );
  });

  it('clínica com convênios + paciente escolheu convênio Amil → cria agendamento com tipoConsulta="convenio" e convenioId correto', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-05-10T10:00:00-03:00',
        nome_paciente: 'Ana Souza',
        tipo_consulta: 'convenio',
        convenio_nome: 'Amil',
      },
    });
    prisma.profissional.findMany.mockResolvedValue([PROFISSIONAL_COM_CONVENIO]);
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_AMIL, CONVENIO_UNIMED]);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Consulta agendada pelo plano Amil!',
      controle: {
        intencao: 'agendar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, tipo_consulta: null, convenio_nome: null, data_hora: null, nome_paciente: null, agendamento_id: null },
        acao: 'criar_agendamento',
        confianca: 0.97,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sim, pode agendar', CLINICA);

    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
    expect(prisma.agendamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoConsulta: 'convenio',
          convenioId: CONVENIO_AMIL.id,
        }),
      })
    );
  });

  it('clínica com convênios + paciente escolheu particular → cria agendamento com tipoConsulta="particular"', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-05-10T10:00:00-03:00',
        nome_paciente: 'Paulo Melo',
        tipo_consulta: 'particular',
      },
    });
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_AMIL]);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Consulta particular agendada!',
      controle: {
        intencao: 'agendar',
        novo_estado: 'concluido',
        dados_extraidos: { especialidade: null, profissional_id: null, tipo_consulta: null, convenio_nome: null, data_hora: null, nome_paciente: null, agendamento_id: null },
        acao: 'criar_agendamento',
        confianca: 0.95,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Sim, particular mesmo', CLINICA);

    expect(prisma.agendamento.create).toHaveBeenCalledOnce();
    expect(prisma.agendamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoConsulta: 'particular',
          convenioId: null,
        }),
      })
    );
  });

  it('clínica com convênios + tipo_consulta ausente no contexto → não cria agendamento (dados incompletos)', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-05-10T10:00:00-03:00',
        nome_paciente: 'Lucia Ferreira',
        // tipo_consulta ausente → incompleto quando clínica tem convênios
      },
    });
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_AMIL]);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Confirma particular ou convênio?',
      controle: {
        intencao: 'agendar',
        novo_estado: 'escolhendo_convenio',
        dados_extraidos: { especialidade: null, profissional_id: null, tipo_consulta: null, convenio_nome: null, data_hora: null, nome_paciente: null, agendamento_id: null },
        acao: 'criar_agendamento', // Claude tentou, mas dados incompletos
        confianca: 0.7,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Quero agendar', CLINICA);

    // Sem tipo_consulta definido quando há convênios → não deve criar
    expect(prisma.agendamento.create).not.toHaveBeenCalled();
  });

  it('clínica com convênios + tipo=convênio mas sem convenio_nome → não cria agendamento', async () => {
    setupPrismaMocks({
      estadoAtual: 'confirmando',
      contextoJson: {
        profissional_id: PROFISSIONAL.id,
        data_hora: '2026-05-10T10:00:00-03:00',
        nome_paciente: 'Marcos Lima',
        tipo_consulta: 'convenio',
        // convenio_nome ausente → incompleto
      },
    });
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_AMIL]);
    processMessage.mockResolvedValueOnce({
      mensagemParaPaciente: 'Qual o seu plano de saúde?',
      controle: {
        intencao: 'agendar',
        novo_estado: 'escolhendo_convenio',
        dados_extraidos: { especialidade: null, profissional_id: null, tipo_consulta: null, convenio_nome: null, data_hora: null, nome_paciente: null, agendamento_id: null },
        acao: 'criar_agendamento',
        confianca: 0.75,
      },
    });

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Convênio', CLINICA);

    expect(prisma.agendamento.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// TESTE 6 — Interceptação determinística do fluxo de convênio
// =====================================================================

describe('conversationService — interceptação determinística (escolhendo_convenio / escolhendo_plano)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: configura clínica com convênios e profissional vinculado.
   * Por padrão tem PROFISSIONAL_COM_CONVENIO (vinculado ao Amil) + Unimed sem ninguém.
   */
  function setupClinicaComConvenios({ estadoAtual, contextoJson = {} } = {}) {
    setupPrismaMocks({ estadoAtual, contextoJson });
    prisma.profissional.findMany.mockResolvedValue([PROFISSIONAL_COM_CONVENIO]);
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_AMIL, CONVENIO_UNIMED]);
  }

  it('estado escolhendo_convenio + "1" + único profissional → pula seleção e vai para escolhendo_horario com slots', async () => {
    setupClinicaComConvenios({ estadoAtual: 'escolhendo_convenio' });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '1', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Particular');
    expect(resposta).toContain(PROFISSIONAL_COM_CONVENIO.nome);
    expect(resposta).not.toContain('digite o número');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'escolhendo_horario',
          contextoJson: expect.objectContaining({
            tipo_consulta: 'particular',
            profissional_id: PROFISSIONAL_COM_CONVENIO.id,
          }),
        }),
      })
    );
  });

  it('estado escolhendo_convenio + "1" + múltiplos profissionais → mantém lista para o paciente escolher', async () => {
    const SEGUNDO_PROF = { ...PROFISSIONAL, id: 'prof-uuid-002', nome: 'Dra. Maria Santos', convenios: [] };
    setupPrismaMocks({ estadoAtual: 'escolhendo_convenio' });
    prisma.profissional.findMany.mockResolvedValue([PROFISSIONAL_COM_CONVENIO, SEGUNDO_PROF]);
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_AMIL]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '1', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Particular');
    expect(resposta).toContain('digite o número');
    expect(resposta).toContain(PROFISSIONAL_COM_CONVENIO.nome);
    expect(resposta).toContain(SEGUNDO_PROF.nome);
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'escolhendo_especialidade',
          contextoJson: expect.objectContaining({ tipo_consulta: 'particular' }),
        }),
      })
    );
  });

  it('estado escolhendo_convenio + "2" → transita para escolhendo_plano e exibe lista de planos, sem chamar LLM', async () => {
    setupClinicaComConvenios({ estadoAtual: 'escolhendo_convenio' });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '2', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('plano de saúde');
    expect(resposta).toContain('Amil');
    // Unimed só aparece se tiver profissional vinculado — neste setup não tem, então não deve aparecer
    expect(resposta).not.toContain('Unimed');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'escolhendo_plano' }),
      })
    );
  });

  it('estado escolhendo_plano + número correspondente + único profissional do plano → vai direto para escolhendo_horario', async () => {
    setupClinicaComConvenios({ estadoAtual: 'escolhendo_plano' });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '1', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Convênio Amil');
    expect(resposta).toContain(PROFISSIONAL_COM_CONVENIO.nome);
    expect(resposta).not.toContain('digite o número');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'escolhendo_horario',
          contextoJson: expect.objectContaining({
            tipo_consulta: 'convenio',
            convenio_nome: 'Amil',
            profissional_id: PROFISSIONAL_COM_CONVENIO.id,
          }),
        }),
      })
    );
  });

  it('estado escolhendo_plano + nome parcial ("Bradesc" → Bradesco Saúde) → resolve corretamente', async () => {
    const CONVENIO_BRADESCO = { id: 'convenio-uuid-bradesco', clinicaId: CLINICA.id, nome: 'Bradesco Saúde', ativo: true };
    const PROF_BRADESCO = { ...PROFISSIONAL, convenios: [{ convenioId: CONVENIO_BRADESCO.id, convenio: CONVENIO_BRADESCO }] };
    setupPrismaMocks({ estadoAtual: 'escolhendo_plano' });
    prisma.profissional.findMany.mockResolvedValue([PROF_BRADESCO]);
    prisma.convenio.findMany.mockResolvedValue([CONVENIO_BRADESCO]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Bradesc', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Bradesco Saúde');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contextoJson: expect.objectContaining({ convenio_nome: 'Bradesco Saúde' }),
        }),
      })
    );
  });

  it('estado escolhendo_plano + plano inexistente → re-pergunta com lista (texto fixo, sem LLM)', async () => {
    setupClinicaComConvenios({ estadoAtual: 'escolhendo_plano' });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'SulAmérica', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Não entendi');
    expect(resposta).toContain('Amil');
    // Estado NÃO muda — paciente continua em escolhendo_plano
    expect(prisma.estadoConversa.update).not.toHaveBeenCalled();
  });

  it('estado escolhendo_plano + "particular" → muda para particular (paciente mudou de ideia)', async () => {
    setupClinicaComConvenios({ estadoAtual: 'escolhendo_plano' });

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'particular', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Particular');
    // Único profissional → vai direto para escolhendo_horario
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'escolhendo_horario',
          contextoJson: expect.objectContaining({
            tipo_consulta: 'particular',
            convenio_nome: null,
            profissional_id: PROFISSIONAL_COM_CONVENIO.id,
          }),
        }),
      })
    );
  });

  it('estado escolhendo_convenio + texto livre → cai no LLM (não intercepta)', async () => {
    setupClinicaComConvenios({ estadoAtual: 'escolhendo_convenio' });
    processMessage.mockResolvedValueOnce(makeControle({ novo_estado: 'escolhendo_convenio' }));

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'ainda não sei', CLINICA);

    expect(processMessage).toHaveBeenCalled();
  });

  it('clínica sem convênios + estado escolhendo_convenio (caso degenerado) → cai no LLM', async () => {
    setupPrismaMocks({ estadoAtual: 'escolhendo_convenio' });
    prisma.convenio.findMany.mockResolvedValue([]);
    processMessage.mockResolvedValueOnce(makeControle({ novo_estado: 'escolhendo_especialidade' }));

    await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '2', CLINICA);

    // Sem convênios, a interceptação não dispara — LLM responde normalmente
    expect(processMessage).toHaveBeenCalled();
  });
});

// =====================================================================
// TESTE 7 — Cancelamento determinístico (sem LLM)
// =====================================================================

describe('conversationService — cancelamento determinístico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Monta um agendamento ativo com profissional embutido (formato do findMany com include). */
  function fixAgendamento(overrides = {}) {
    return {
      id: 'ag-uuid-001',
      clinicaId: CLINICA.id,
      profissionalId: PROFISSIONAL.id,
      pacienteId: PACIENTE.id,
      dataHora: new Date('2026-06-10T13:00:00.000Z'),
      duracaoMin: 30,
      status: 'agendado',
      calendarEventId: 'cal-event-001',
      reminderJobId: null,
      profissional: { nome: PROFISSIONAL.nome, especialidade: PROFISSIONAL.especialidade },
      paciente: { nome: 'Karen' },
      ...overrides,
    };
  }

  it('inicio + "cancelar" + 0 agendamentos → mensagem de "não encontrei", sem chamar LLM', async () => {
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.agendamento.findMany.mockResolvedValue([]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'Olá, gostaria de cancelar uma consulta', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Não encontrei');
    expect(resposta).toContain('cancelar');
    expect(prisma.agendamento.update).not.toHaveBeenCalled();
  });

  it('inicio + "cancelar" + 1 agendamento → vai para cancelando_agendamento step=confirmando', async () => {
    const ag = fixAgendamento();
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.agendamento.findMany.mockResolvedValue([ag]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'cancelar', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Confirma o cancelamento');
    expect(resposta).toContain(PROFISSIONAL.nome);
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'cancelando_agendamento',
          contextoJson: expect.objectContaining({
            cancelamento_step: 'confirmando',
            agendamento_id: ag.id,
          }),
        }),
      })
    );
  });

  it('inicio + "3" do menu inicial → trata como cancelar (mesma rota)', async () => {
    const ag = fixAgendamento();
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.agendamento.findMany.mockResolvedValue([ag]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '3', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Confirma o cancelamento');
  });

  it('inicio + "cancelar" + N agendamentos → lista numerada e estado=selecionando', async () => {
    const ag1 = fixAgendamento({ id: 'ag-1' });
    const ag2 = fixAgendamento({ id: 'ag-2', dataHora: new Date('2026-06-15T15:00:00.000Z') });
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.agendamento.findMany.mockResolvedValue([ag1, ag2]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'quero cancelar uma consulta', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('mais de uma consulta');
    expect(resposta).toContain('1.');
    expect(resposta).toContain('2.');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'cancelando_agendamento',
          contextoJson: expect.objectContaining({
            cancelamento_step: 'selecionando',
            lista_ids: ['ag-1', 'ag-2'],
          }),
        }),
      })
    );
  });

  it('cancelando_agendamento step=selecionando + número válido → vai para confirmando', async () => {
    const ag1 = fixAgendamento({ id: 'ag-1' });
    const ag2 = fixAgendamento({ id: 'ag-2', dataHora: new Date('2026-06-15T15:00:00.000Z') });
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'selecionando', lista_ids: ['ag-1', 'ag-2'] },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag1, ag2]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '2', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Confirma o cancelamento');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'cancelando_agendamento',
          contextoJson: expect.objectContaining({
            cancelamento_step: 'confirmando',
            agendamento_id: 'ag-2',
          }),
        }),
      })
    );
  });

  it('cancelando_agendamento step=selecionando + número inválido → re-pergunta sem mudar estado', async () => {
    const ag1 = fixAgendamento({ id: 'ag-1' });
    const ag2 = fixAgendamento({ id: 'ag-2' });
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'selecionando', lista_ids: ['ag-1', 'ag-2'] },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag1, ag2]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, '5', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Não entendi');
    expect(prisma.estadoConversa.update).not.toHaveBeenCalled();
  });

  it('cancelando_agendamento step=selecionando + "não" → volta para inicio sem cancelar', async () => {
    const ag1 = fixAgendamento({ id: 'ag-1' });
    const ag2 = fixAgendamento({ id: 'ag-2' });
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'selecionando', lista_ids: ['ag-1', 'ag-2'] },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag1, ag2]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'não', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('mantida');
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio', contextoJson: {} }),
      })
    );
    expect(prisma.agendamento.update).not.toHaveBeenCalled();
  });

  it('cancelando_agendamento step=confirmando + "sim" → cancela no banco, remove evento, reseta estado', async () => {
    const ag = fixAgendamento();
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'confirmando', agendamento_id: ag.id },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag]);
    prisma.agendamento.findFirst.mockResolvedValue(ag);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'sim', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('cancelada com sucesso');
    expect(prisma.agendamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ag.id },
        data: { status: 'cancelado' },
      })
    );
    expect(deleteEvent).toHaveBeenCalledWith(CLINICA.id, PROFISSIONAL.id, ag.calendarEventId);
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio', contextoJson: {} }),
      })
    );
  });

  it('cancelando_agendamento step=confirmando + "não" → não cancela e volta para inicio', async () => {
    const ag = fixAgendamento();
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'confirmando', agendamento_id: ag.id },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'nao', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('mantida');
    expect(prisma.agendamento.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio' }),
      })
    );
  });

  it('cancelando_agendamento step=confirmando + texto ambíguo → re-pergunta sem mudar estado', async () => {
    const ag = fixAgendamento();
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'confirmando', agendamento_id: ag.id },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'pode ser', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Não entendi');
    expect(prisma.estadoConversa.update).not.toHaveBeenCalled();
    expect(prisma.agendamento.update).not.toHaveBeenCalled();
  });

  it('cancelando_agendamento step=confirmando + "sim" mas agendamento não encontrado (ex: já cancelado em paralelo) → mensagem de erro e reseta estado', async () => {
    const ag = fixAgendamento();
    setupPrismaMocks({
      estadoAtual: 'cancelando_agendamento',
      contextoJson: { cancelamento_step: 'confirmando', agendamento_id: ag.id },
    });
    prisma.agendamento.findMany.mockResolvedValue([ag]);
    prisma.agendamento.findFirst.mockResolvedValue(null);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'sim', CLINICA);

    expect(resposta).toContain('Não consegui localizar');
    expect(prisma.agendamento.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelado' } })
    );
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio' }),
      })
    );
  });

  it('inicio + agendamento com status "agendado" (não confirmado pelo lembrete) → ainda assim aparece e pode ser cancelado', async () => {
    // Bug histórico: o filtro era status='confirmado' apenas, então agendamentos recém-criados
    // ficavam invisíveis. Após o fix, status agendado também conta como ativo.
    const agAgendado = fixAgendamento({ status: 'agendado' });
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.agendamento.findMany.mockResolvedValue([agAgendado]);

    const resposta = await handleIncomingMessage(CLINICA.id, PACIENTE.telefone, 'cancelar', CLINICA);

    expect(processMessage).not.toHaveBeenCalled();
    expect(resposta).toContain('Confirma o cancelamento');
    // Verifica que o filtro de findMany usou o "in" com agendado e confirmado
    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['agendado', 'confirmado'] },
        }),
      })
    );
  });
});
