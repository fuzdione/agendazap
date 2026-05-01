import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted para que estejam disponíveis antes dos imports) ---

const { mockMessagesCreate } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockMessagesCreate };
    }
  },
}));

vi.mock('../../config/env.js', () => ({
  env: {
    CLAUDE_API_KEY: 'sk-ant-test',
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://test',
    REDIS_URL: 'redis://test',
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'test-key',
    JWT_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/callback',
  },
}));

import { processMessage, buildSystemPrompt } from '../claudeService.js';

// --- Helpers ---

/** Monta uma resposta simulada da Claude API com JSON de controle */
function makeApiResponse(mensagem, controle) {
  const json = JSON.stringify(controle);
  return {
    content: [{ text: `${mensagem}\n\n<json>${json}</json>` }],
  };
}

const CONTROLE_PADRAO = {
  intencao: 'saudacao',
  novo_estado: 'escolhendo_especialidade',
  dados_extraidos: { especialidade: null, profissional_id: null, data_hora: null, nome_paciente: null },
  acao: 'nenhuma',
  confianca: 0.9,
};

// =====================================================================
// TESTE 1 — Parsing do JSON de controle
// =====================================================================

describe('claudeService — processMessage: parsing do JSON de controle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extrai o JSON de controle corretamente das tags <json></json>', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeApiResponse('Olá! Como posso ajudar?', CONTROLE_PADRAO));

    const { controle } = await processMessage('Oi', 'system', [], 'inicio');

    expect(controle.intencao).toBe('saudacao');
    expect(controle.novo_estado).toBe('escolhendo_especialidade');
    expect(controle.confianca).toBe(0.9);
    expect(controle.acao).toBe('nenhuma');
  });

  it('remove as tags <json></json> da mensagem visível ao paciente', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeApiResponse('Olá! Como posso ajudar?', CONTROLE_PADRAO));

    const { mensagemParaPaciente } = await processMessage('Oi', 'system', [], 'inicio');

    expect(mensagemParaPaciente).toBe('Olá! Como posso ajudar?');
    expect(mensagemParaPaciente).not.toContain('<json>');
    expect(mensagemParaPaciente).not.toContain('</json>');
    expect(mensagemParaPaciente).not.toContain('novo_estado');
  });

  it('retorna controle com valores padrão seguros quando JSON não está presente', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ text: 'Desculpe, não entendi. Pode repetir?' }],
    });

    const { controle, mensagemParaPaciente } = await processMessage('???', 'system', [], 'confirmando');

    expect(mensagemParaPaciente).toBe('Desculpe, não entendi. Pode repetir?');
    expect(controle.intencao).toBe('outro');
    expect(controle.novo_estado).toBe('confirmando'); // preserva estado atual
    expect(controle.acao).toBe('nenhuma');
    expect(controle.confianca).toBe(0.0);
    expect(controle.dados_extraidos).toEqual({
      especialidade: null,
      profissional_id: null,
      tipo_consulta: null,
      convenio_nome: null,
      data_hora: null,
      nome_paciente: null,
      agendamento_id: null,
    });
  });

  it('retorna controle com valores padrão seguros quando JSON está malformado', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ text: 'Tudo bem! <json>{ malformed json: }</json>' }],
    });

    const { controle, mensagemParaPaciente } = await processMessage('oi', 'system', [], 'inicio');

    expect(mensagemParaPaciente).toBe('Tudo bem!');
    expect(controle.acao).toBe('nenhuma');
    expect(controle.novo_estado).toBe('inicio');
  });

  it('retorna mensagem de fallback amigável quando a API falha', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('Network error'));

    const { mensagemParaPaciente, controle } = await processMessage('Oi', 'system', [], 'inicio');

    expect(mensagemParaPaciente).toContain('instabilidade');
    expect(controle.acao).toBe('nenhuma');
    expect(controle.confianca).toBe(0.0);
  });

  it('retorna mensagem de fallback quando a API retorna erro 429 (rate limit)', async () => {
    const err = new Error('Rate limit');
    err.status = 429;
    mockMessagesCreate.mockRejectedValueOnce(err);

    const { mensagemParaPaciente } = await processMessage('Oi', 'system', [], 'inicio');

    expect(mensagemParaPaciente).toContain('instabilidade');
  });

  it('inclui o histórico de conversa como messages para o Claude', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeApiResponse('Ok!', CONTROLE_PADRAO));

    const historico = [
      { direcao: 'entrada', mensagem: 'Quero agendar' },
      { direcao: 'saida', mensagem: 'Qual especialidade?' },
    ];

    await processMessage('Dermatologia', 'system', historico, 'escolhendo_especialidade');

    const chamada = mockMessagesCreate.mock.calls[0][0];
    expect(chamada.messages).toHaveLength(3); // 2 histórico + 1 atual
    expect(chamada.messages[0]).toEqual({ role: 'user', content: 'Quero agendar' });
    expect(chamada.messages[1]).toEqual({ role: 'assistant', content: 'Qual especialidade?' });
    expect(chamada.messages[2]).toEqual({ role: 'user', content: 'Dermatologia' });
  });
});

// =====================================================================
// TESTE 3 — buildSystemPrompt
// =====================================================================

describe('claudeService — buildSystemPrompt', () => {
  const clinica = {
    id: 'clinica-uuid-001',
    nome: 'Clínica Saúde Plena',
    endereco: 'SHLS 716, Sala 301 — Brasília/DF',
  };

  const profissionais = [
    { id: 'prof-001', nome: 'Dr. João Silva', especialidade: 'Clínico Geral', duracaoConsultaMin: 30 },
    { id: 'prof-002', nome: 'Dra. Maria Santos', especialidade: 'Dermatologia', duracaoConsultaMin: 40 },
  ];

  const horariosDisponiveis = [
    {
      profissional: profissionais[0],
      slots: [{ dia_semana: 'Segunda', data: '30/03', slots: ['08:00', '08:30'] }],
    },
    {
      profissional: profissionais[1],
      slots: [],
    },
  ];

  const estadoConversa = {
    estado: 'escolhendo_especialidade',
    contextoJson: { especialidade: 'Dermatologia' },
  };

  it('inclui o nome da clínica no prompt', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('Clínica Saúde Plena');
  });

  it('inclui o endereço da clínica no prompt', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('SHLS 716, Sala 301');
  });

  it('inclui a lista de profissionais com especialidade e duração', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('Dr. João Silva');
    expect(prompt).toContain('Clínico Geral');
    expect(prompt).toContain('Dra. Maria Santos');
    expect(prompt).toContain('Dermatologia');
    expect(prompt).toContain('40 min');
  });

  it('inclui os horários disponíveis formatados por profissional', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('08:00');
    expect(prompt).toContain('30/03');
  });

  it('indica "sem horários disponíveis" quando profissional não tem slots', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('sem horários disponíveis');
  });

  it('inclui o estado atual da conversa', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('escolhendo_especialidade');
  });

  it('inclui o contexto acumulado da conversa em JSON', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('Dermatologia');
  });

  it('usa "endereço não informado" quando clínica não tem endereço', () => {
    const clinicaSemEndereco = { ...clinica, endereco: null };
    const prompt = buildSystemPrompt(clinicaSemEndereco, profissionais, horariosDisponiveis, estadoConversa);
    expect(prompt).toContain('endereço não informado');
  });

  it('lista "(nenhum profissional cadastrado)" quando lista está vazia', () => {
    const prompt = buildSystemPrompt(clinica, [], [], estadoConversa);
    expect(prompt).toContain('nenhum profissional cadastrado');
  });

  it('quando clínica NÃO tem convênios → não pergunta sobre tipo de consulta e não lista convênios', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, [], [], []);
    expect(prompt).not.toContain('Particular ou Convênio');
    expect(prompt).toContain('atendimento apenas particular');
  });

  it('quando clínica TEM convênios → instrui o LLM a perguntar Particular ou Convênio (Caso 2) e lista os planos aceitos', () => {
    const convenios = [
      { id: 'conv-001', nome: 'Amil', ativo: true },
      { id: 'conv-002', nome: 'Unimed', ativo: true },
    ];
    const profsComConv = [
      { ...profissionais[0], atendeParticular: true, convenios: [{ id: 'conv-001', nome: 'Amil' }] },
      { ...profissionais[1], atendeParticular: true, convenios: [{ id: 'conv-002', nome: 'Unimed' }] },
    ];
    const prompt = buildSystemPrompt(clinica, profsComConv, horariosDisponiveis, estadoConversa, [], [], convenios);
    // Caso 2 (paciente quer agendar): LLM deve perguntar particular ou convênio
    expect(prompt).toContain('particular ou convênio');
    // Convênios aceitos listados na seção de informação ao paciente
    expect(prompt).toContain('Amil');
    expect(prompt).toContain('Unimed');
  });

  it('quando clínica TEM convênios → fluxo esperado e enum de novo_estado mencionam escolhendo_convenio', () => {
    const convenios = [{ id: 'conv-001', nome: 'Amil', ativo: true }];
    const profsComConv = [
      { ...profissionais[0], atendeParticular: true, convenios: [{ id: 'conv-001', nome: 'Amil' }] },
      profissionais[1],
    ];
    const prompt = buildSystemPrompt(clinica, profsComConv, horariosDisponiveis, estadoConversa, [], [], convenios);
    // O estado escolhendo_convenio aparece no FLUXO ESPERADO e no enum do JSON de controle
    expect(prompt).toContain('escolhendo_convenio');
    expect(prompt).toContain('escolhendo_plano');
  });

  it('quando clínica NÃO tem convênios → NÃO inclui seção PERGUNTA SOBRE CONVÊNIO', () => {
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, [], [], []);
    // Sem convênios, a seção de pergunta não deve aparecer
    expect(prompt).not.toContain('PERGUNTA SOBRE CONVÊNIO');
  });

  it('profissional com convênios → exibe convênios na lista de profissionais', () => {
    const profComConvenio = [
      { ...profissionais[0], atendeParticular: true, convenios: [{ nome: 'Amil' }] },
      { ...profissionais[1], atendeParticular: false, convenios: [] },
    ];
    const convenios = [{ id: 'conv-001', nome: 'Amil', ativo: true }];
    const prompt = buildSystemPrompt(clinica, profComConvenio, horariosDisponiveis, estadoConversa, [], [], convenios);
    expect(prompt).toContain('convênios: Amil');
    expect(prompt).toContain('atende: particular');
  });

  it('confirmação do agendamento menciona tipo: particular ou convênio no prompt', () => {
    const convenios = [{ id: 'conv-001', nome: 'Amil', ativo: true }];
    const prompt = buildSystemPrompt(clinica, profissionais, horariosDisponiveis, estadoConversa, [], [], convenios);
    expect(prompt).toContain('Convênio: Amil');
    expect(prompt).toContain('Particular');
  });
});
