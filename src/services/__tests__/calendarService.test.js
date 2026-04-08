import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks (hoisted para estar disponíveis antes dos imports) ────────────────

const { mockFreebusyQuery, mockGetAuthenticatedClient, mockGenerateMockSlots } = vi.hoisted(() => ({
  mockFreebusyQuery: vi.fn(),
  mockGetAuthenticatedClient: vi.fn(),
  mockGenerateMockSlots: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      freebusy:     { query: mockFreebusyQuery },
      calendarList: { list: vi.fn().mockResolvedValue({ data: { items: [] } }) },
      events: {
        insert: vi.fn().mockResolvedValue({ data: { id: 'event-id-test' } }),
        delete: vi.fn().mockResolvedValue({}),
      },
    })),
  },
}));

vi.mock('../../config/google.js', () => ({
  getAuthenticatedClient: mockGetAuthenticatedClient,
}));

vi.mock('../../config/database.js', () => ({
  prisma: {
    profissional: { findUnique: vi.fn() },
    clinica:      { findUnique: vi.fn() },
  },
}));

vi.mock('../../utils/mockSlots.js', () => ({
  generateMockSlots: mockGenerateMockSlots,
}));

vi.mock('../../config/env.js', () => ({
  env: {
    GOOGLE_CLIENT_ID:     'test-client-id',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret',
    GOOGLE_REDIRECT_URI:  'http://localhost:3000/admin/google/callback',
    NODE_ENV:    'test',
    PORT:        3000,
    DATABASE_URL: 'postgresql://test',
    REDIS_URL:   'redis://test',
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'test-key',
    JWT_SECRET:  'test-jwt-secret-12345',
  },
}));

import { prisma } from '../../config/database.js';
import { getAvailableSlots, checkConflict } from '../calendarService.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLINICA_ID      = 'clinica-uuid-001';
const PROFISSIONAL_ID = 'prof-uuid-001';
const CALENDAR_ID     = 'drjoao@group.calendar.google.com';

const PROF_COM_CALENDAR = {
  id: PROFISSIONAL_ID,
  clinicaId: CLINICA_ID,
  calendarId: CALENDAR_ID,
  duracaoConsultaMin: 30,
  ativo: true,
  nome: 'Dr. João Silva',
  especialidade: 'Clínico Geral',
};

const MOCK_SLOTS_FALLBACK = [
  { data: '2026-04-06', dia_semana: 'Segunda', slots: ['08:00', '09:00'] },
];

/**
 * Monta a resposta simulada do freebusy.query com os períodos ocupados fornecidos.
 * @param {Array<{start: string, end: string}>} busy
 */
function makeFreebusy(busy = []) {
  return { data: { calendars: { [CALENDAR_ID]: { busy } } } };
}

// Datas de referência usando new Date(year, month, day, hour) — hora LOCAL.
// Isso garante que os testes são consistentes independente do fuso horário do ambiente,
// pois slotInicio.setHours() também opera em hora local.

// Segunda 06/04/2026 às 06:00 local → corteAntecedencia = 08:00 → TODOS os slots do dia disponíveis
const SEGUNDA_06H = new Date(2026, 3, 6, 6, 0, 0);
// Segunda 06/04/2026 às 14:00 local → corteAntecedencia = 16:00 → apenas slots a partir de 16:00
const SEGUNDA_14H = new Date(2026, 3, 6, 14, 0, 0);
// Domingo 29/03/2026 às 06:00 local
const DOMINGO_06H = new Date(2026, 2, 29, 6, 0, 0);

// Janela: apenas segunda-feira 06/04/2026
const DATA_INICIO_SEGUNDA = new Date(2026, 3, 6,  0, 0, 0);
const DATA_FIM_SEGUNDA    = new Date(2026, 3, 7,  0, 0, 0);

// Janela: apenas domingo 29/03/2026
const DATA_INICIO_DOMINGO = new Date(2026, 2, 29, 0, 0, 0);
const DATA_FIM_DOMINGO    = new Date(2026, 2, 30, 0, 0, 0);

// =====================================================================
// TESTE 1 — getAvailableSlots (Google Calendar real)
// =====================================================================

describe('calendarService — getAvailableSlots com Google Calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.profissional.findUnique.mockResolvedValue(PROF_COM_CALENDAR);
    prisma.clinica.findUnique.mockResolvedValue({ configJson: {} }); // usa todos os defaults
    mockGetAuthenticatedClient.mockResolvedValue({});
    mockFreebusyQuery.mockResolvedValue(makeFreebusy()); // sem conflitos
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna apenas horários dentro do horário de funcionamento (08:00–17:30)', async () => {
    vi.useFakeTimers({ now: SEGUNDA_06H }); // corteAntecedencia = 08:00 local

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, DATA_INICIO_SEGUNDA, DATA_FIM_SEGUNDA);

    expect(result).toHaveLength(1);
    const { slots } = result[0];

    // Com 30min de duração/intervalo e expediente 08–18 (com pausa de almoço 12–13), deve ter 18 slots
    expect(slots).toHaveLength(18);
    expect(slots[0]).toBe('08:00');
    expect(slots[slots.length - 1]).toBe('17:30');

    // Nenhum slot fora do expediente
    slots.forEach((s) => {
      expect(s >= '08:00').toBe(true);
      expect(s <= '17:30').toBe(true);
    });
    expect(slots).not.toContain('18:00');
  });

  it('não retorna horários com menos de 2h de antecedência', async () => {
    vi.useFakeTimers({ now: SEGUNDA_14H }); // corteAntecedencia = 16:00 local

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, DATA_INICIO_SEGUNDA, DATA_FIM_SEGUNDA);

    expect(result).toHaveLength(1);
    const { slots } = result[0];

    // Apenas 16:00, 16:30, 17:00, 17:30
    expect(slots).toHaveLength(4);
    expect(slots).toContain('16:00');
    expect(slots).toContain('16:30');
    expect(slots).toContain('17:00');
    expect(slots).toContain('17:30');

    // Nenhum slot antes da janela de 2h
    slots.forEach((s) => expect(s >= '16:00').toBe(true));
    expect(slots).not.toContain('15:30');
  });

  it('não retorna horários já ocupados no Google Calendar (freebusy)', async () => {
    vi.useFakeTimers({ now: SEGUNDA_06H });

    // Ocupa o slot das 09:00 às 09:30
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([{
      start: new Date(2026, 3, 6, 9,  0, 0).toISOString(),
      end:   new Date(2026, 3, 6, 9, 30, 0).toISOString(),
    }]));

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, DATA_INICIO_SEGUNDA, DATA_FIM_SEGUNDA);
    const { slots } = result[0];

    expect(slots).not.toContain('09:00');   // slot ocupado removido
    expect(slots).toContain('08:30');        // slot imediatamente anterior: livre
    expect(slots).toContain('09:30');        // slot imediatamente posterior: livre
  });

  it('não retorna horário cujo final invade um período ocupado', async () => {
    vi.useFakeTimers({ now: SEGUNDA_06H });

    // Ocupado de 09:15 a 09:45 — invade o final do slot 09:00–09:30
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([{
      start: new Date(2026, 3, 6, 9, 15, 0).toISOString(),
      end:   new Date(2026, 3, 6, 9, 45, 0).toISOString(),
    }]));

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, DATA_INICIO_SEGUNDA, DATA_FIM_SEGUNDA);
    const { slots } = result[0];

    // 09:00 tem fim em 09:30, que invade o busy de 09:15 → deve ser removido
    expect(slots).not.toContain('09:00');
    // 08:30 tem fim em 09:00, que NÃO invade o busy de 09:15 → deve permanecer
    expect(slots).toContain('08:30');
  });

  it('respeita a duração de consulta de cada profissional', async () => {
    vi.useFakeTimers({ now: SEGUNDA_06H });

    // Profissional com consultas de 60 minutos
    prisma.profissional.findUnique.mockResolvedValue({
      ...PROF_COM_CALENDAR,
      duracaoConsultaMin: 60,
    });

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, DATA_INICIO_SEGUNDA, DATA_FIM_SEGUNDA);
    const { slots } = result[0];

    // Com 60min de duração e intervalo (padrão = duracaoMin) e pausa de almoço 12–13, gera 9 slots: 08:00–17:00
    expect(slots).toHaveLength(9);
    expect(slots[0]).toBe('08:00');
    expect(slots[1]).toBe('09:00');     // segundo slot exatamente 60min depois
    expect(slots[slots.length - 1]).toBe('17:00');

    // Não deve gerar slots de 30min
    expect(slots).not.toContain('08:30');
    expect(slots).not.toContain('09:30');
  });

  it('não gera slots em domingo', async () => {
    vi.useFakeTimers({ now: DOMINGO_06H });

    // Janela contém apenas o domingo 29/03/2026
    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, DATA_INICIO_DOMINGO, DATA_FIM_DOMINGO);

    expect(result).toHaveLength(0);
  });
});

// =====================================================================
// TESTE 2 — checkConflict
// =====================================================================

describe('calendarService — checkConflict', () => {
  // Slot: segunda 06/04/2026 às 10:00 local, 30 min de duração
  const DATA_HORA  = new Date(2026, 3, 6, 10,  0, 0);
  const DURACAO    = 30;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.profissional.findUnique.mockResolvedValue(PROF_COM_CALENDAR);
    mockGetAuthenticatedClient.mockResolvedValue({});
  });

  it('retorna false quando o horário está livre', async () => {
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([]));

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, DATA_HORA, DURACAO);

    expect(resultado).toBe(false);
  });

  it('retorna true quando o horário está exatamente ocupado', async () => {
    // Busy cobre exatamente 10:00–10:30
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([{
      start: new Date(2026, 3, 6, 10,  0, 0).toISOString(),
      end:   new Date(2026, 3, 6, 10, 30, 0).toISOString(),
    }]));

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, DATA_HORA, DURACAO);

    expect(resultado).toBe(true);
  });

  it('retorna true quando período ocupado sobrepõe o início do slot', async () => {
    // Busy de 09:45 a 10:15 — invade o início do slot 10:00
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([{
      start: new Date(2026, 3, 6,  9, 45, 0).toISOString(),
      end:   new Date(2026, 3, 6, 10, 15, 0).toISOString(),
    }]));

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, DATA_HORA, DURACAO);

    expect(resultado).toBe(true);
  });

  it('retorna true quando período ocupado sobrepõe o final do slot', async () => {
    // Busy de 10:15 a 11:00 — invade o final do slot 10:00–10:30
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([{
      start: new Date(2026, 3, 6, 10, 15, 0).toISOString(),
      end:   new Date(2026, 3, 6, 11,  0, 0).toISOString(),
    }]));

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, DATA_HORA, DURACAO);

    expect(resultado).toBe(true);
  });

  it('retorna false quando período ocupado termina exatamente quando o slot começa', async () => {
    // O Google Calendar não inclui na resposta períodos que terminam exatamente em timeMin.
    // Simulamos isso retornando busy vazio — o que a API real retornaria para uma query
    // de [10:00, 10:30] quando o único busy é [09:30, 10:00].
    mockFreebusyQuery.mockResolvedValue(makeFreebusy([]));

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, DATA_HORA, DURACAO);

    expect(resultado).toBe(false);
  });

  it('retorna false quando profissional não tem calendarId (não há como verificar)', async () => {
    prisma.profissional.findUnique.mockResolvedValue({
      ...PROF_COM_CALENDAR,
      calendarId: null,
    });

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, DATA_HORA, DURACAO);

    expect(resultado).toBe(false);
    expect(mockFreebusyQuery).not.toHaveBeenCalled();
  });
});

// =====================================================================
// TESTE 3 — Fallback para mock
// =====================================================================

describe('calendarService — fallback para mock quando Google Calendar indisponível', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateMockSlots.mockReturnValue(MOCK_SLOTS_FALLBACK);
  });

  it('usa mock quando profissional não tem calendarId configurado', async () => {
    prisma.profissional.findUnique.mockResolvedValue({
      ...PROF_COM_CALENDAR,
      calendarId: null,
    });

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, new Date(), new Date());

    expect(result).toEqual(MOCK_SLOTS_FALLBACK);
    expect(mockGenerateMockSlots).toHaveBeenCalledOnce();
    // Não deve ter chamado a API real
    expect(mockFreebusyQuery).not.toHaveBeenCalled();
    expect(mockGetAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('usa mock quando clínica não tem Google Calendar autorizado (GOOGLE_NOT_AUTHORIZED)', async () => {
    prisma.profissional.findUnique.mockResolvedValue(PROF_COM_CALENDAR);
    const err = Object.assign(new Error('Não autorizado'), { code: 'GOOGLE_NOT_AUTHORIZED' });
    mockGetAuthenticatedClient.mockRejectedValue(err);

    const result = await getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, new Date(), new Date());

    expect(result).toEqual(MOCK_SLOTS_FALLBACK);
    expect(mockGenerateMockSlots).toHaveBeenCalledOnce();
  });

  it('usa mock e não lança exceção quando Google API falha com erro de rede', async () => {
    prisma.profissional.findUnique.mockResolvedValue(PROF_COM_CALENDAR);
    prisma.clinica.findUnique.mockResolvedValue({ configJson: {} });
    mockGetAuthenticatedClient.mockResolvedValue({});
    mockFreebusyQuery.mockRejectedValue(new Error('Network error: connection refused'));

    await expect(
      getAvailableSlots(CLINICA_ID, PROFISSIONAL_ID, new Date(), new Date())
    ).resolves.toEqual(MOCK_SLOTS_FALLBACK);

    expect(mockGenerateMockSlots).toHaveBeenCalledOnce();
  });

  it('checkConflict retorna false sem lançar exceção quando Google API falha', async () => {
    prisma.profissional.findUnique.mockResolvedValue(PROF_COM_CALENDAR);
    mockGetAuthenticatedClient.mockResolvedValue({});
    mockFreebusyQuery.mockRejectedValue(new Error('Quota exceeded'));

    const resultado = await checkConflict(CLINICA_ID, PROFISSIONAL_ID, new Date(), 30);

    // Conservador: assume sem conflito para não bloquear o paciente em caso de falha
    expect(resultado).toBe(false);
  });
});
