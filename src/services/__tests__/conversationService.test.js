import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('../../config/database.js', () => ({
  prisma: {
    paciente: {
      findUnique: vi.fn(),
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
      create: vi.fn(),
      update: vi.fn(), // usado para salvar calendarEventId após createEvent
    },
  },
}));

vi.mock('../claudeService.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt de teste'),
  processMessage: vi.fn(),
}));

vi.mock('../calendarService.js', () => ({
  getAvailableSlots: vi.fn().mockResolvedValue([
    { dia_semana: 'Segunda', data: '30/03', slots: ['08:00', '09:00'] },
  ]),
  createEvent:   vi.fn().mockResolvedValue('calendar-event-mock-id'),
  checkConflict: vi.fn().mockResolvedValue(false),
}));

import { prisma } from '../../config/database.js';
import { processMessage } from '../claudeService.js';
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
  prisma.paciente.findUnique.mockResolvedValue(PACIENTE);
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
    expect(prisma.estadoConversa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'inicio', contextoJson: {} }),
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

  it('confiança baixa (<0.6) → adiciona mensagem de fallback com contato humano', async () => {
    setupPrismaMocks({ estadoAtual: 'inicio' });
    processMessage.mockResolvedValueOnce(makeControle({
      mensagemParaPaciente: 'Não entendi bem.',
      novo_estado: 'inicio',
      confianca: 0.4,
    }));
    // processMessage retorna o objeto com mensagemParaPaciente no nível errado — corrigir:
    processMessage.mockReset();
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
    expect(resposta).toContain('recepção');
  });

  it('cria paciente automaticamente se não existir no banco', async () => {
    setupPrismaMocks({ estadoAtual: 'inicio' });
    prisma.paciente.findUnique.mockResolvedValueOnce(null); // paciente não existe
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
