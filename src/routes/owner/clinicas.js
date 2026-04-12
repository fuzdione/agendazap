import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';
import { isValidBRPhone } from '../../utils/phoneHelper.js';
import { getInstanceStatus } from '../../services/whatsappService.js';

/**
 * Gera senha aleatória de N caracteres (letras maiúsculas, minúsculas e números).
 */
function gerarSenhaAleatoria(tamanho = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += chars[Math.floor(Math.random() * chars.length)];
  }
  return senha;
}

/**
 * Consulta o status WhatsApp de uma clínica, retornando string legível.
 * Não lança erro — retorna "sem_instancia" em caso de falha.
 */
async function resolverStatusWhatsapp(telefoneWpp) {
  try {
    const data = await Promise.race([
      getInstanceStatus(telefoneWpp),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    const state = data?.instance?.state ?? data?.state ?? 'unknown';
    return state === 'open' ? 'conectado' : 'desconectado';
  } catch {
    return 'sem_instancia';
  }
}

/**
 * Rotas CRUD de clínicas para o proprietário da solução.
 */
export async function ownerClinicasRoutes(fastify) {
  /**
   * Lista todas as clínicas com métricas e status WhatsApp.
   * Suporta filtros por ativo, busca por nome/telefone e paginação.
   */
  fastify.get('/owner/clinicas', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { ativo, busca, page = '1', limit = '20' } = request.query;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const where = {};

    if (ativo !== undefined) {
      where.ativo = ativo === 'true';
    }

    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { telefoneWpp: { contains: busca } },
      ];
    }

    const [total, clinicas] = await Promise.all([
      prisma.clinica.count({ where }),
      prisma.clinica.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { nome: 'asc' },
        select: {
          id: true,
          nome: true,
          telefoneWpp: true,
          endereco: true,
          ativo: true,
          createdAt: true,
          _count: {
            select: {
              agendamentos: true,
              pacientes: true,
            },
          },
        },
      }),
    ]);

    // Verifica status WhatsApp de cada clínica em paralelo
    const clinicasComStatus = await Promise.all(
      clinicas.map(async (c) => {
        const statusWhatsapp = await resolverStatusWhatsapp(c.telefoneWpp);
        return {
          id: c.id,
          nome: c.nome,
          telefoneWpp: c.telefoneWpp,
          endereco: c.endereco,
          ativo: c.ativo,
          createdAt: c.createdAt,
          totalAgendamentos: c._count.agendamentos,
          totalPacientes: c._count.pacientes,
          statusWhatsapp,
        };
      }),
    );

    return reply.send({
      success: true,
      data: {
        clinicas: clinicasComStatus,
        paginacao: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  });

  /**
   * Cria nova clínica com admin em transação atômica.
   */
  fastify.post('/owner/clinicas', {
    preHandler: [fastify.authenticateOwner],
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'telefoneWpp', 'adminEmail', 'adminSenha'],
        properties: {
          nome:       { type: 'string', minLength: 2 },
          telefoneWpp: { type: 'string' },
          endereco:   { type: 'string' },
          adminEmail: { type: 'string', format: 'email' },
          adminSenha: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { nome, telefoneWpp, endereco, adminEmail, adminSenha } = request.body;

    if (!isValidBRPhone(telefoneWpp)) {
      return reply.status(422).send({ success: false, error: 'Número de telefone brasileiro inválido' });
    }

    // Verifica unicidade de telefone e email em paralelo
    const [telefoneExistente, emailExistente] = await Promise.all([
      prisma.clinica.findUnique({ where: { telefoneWpp } }),
      prisma.usuarioAdmin.findUnique({ where: { email: adminEmail } }),
    ]);

    if (telefoneExistente) {
      return reply.status(409).send({ success: false, error: 'Este número de telefone já está cadastrado em outra clínica' });
    }

    if (emailExistente) {
      return reply.status(409).send({ success: false, error: 'Este e-mail já está em uso por outro administrador' });
    }

    const senhaHash = await bcrypt.hash(adminSenha, 10);

    const { clinica, admin } = await prisma.$transaction(async (tx) => {
      const novaClinica = await tx.clinica.create({
        data: {
          nome,
          telefoneWpp,
          endereco: endereco || null,
          ativo: true,
          configJson: {
            horario_funcionamento: {
              seg_sex: { inicio: '08:00', fim: '18:00' },
              sab: { inicio: '08:00', fim: '12:00' },
            },
            intervalo_slots_min: 10,
          },
        },
      });

      const novoAdmin = await tx.usuarioAdmin.create({
        data: {
          clinicaId: novaClinica.id,
          email: adminEmail,
          senhaHash,
        },
      });

      return { clinica: novaClinica, admin: novoAdmin };
    });

    return reply.status(201).send({
      success: true,
      data: {
        clinica: {
          id: clinica.id,
          nome: clinica.nome,
          telefoneWpp: clinica.telefoneWpp,
          ativo: clinica.ativo,
        },
        admin: { email: admin.email },
      },
    });
  });

  /**
   * Retorna dados completos de uma clínica específica.
   */
  fastify.get('/owner/clinicas/:id', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { id } = request.params;

    const clinica = await prisma.clinica.findUnique({
      where: { id },
      include: {
        profissionais: {
          where: { ativo: true },
          select: {
            id: true,
            nome: true,
            especialidade: true,
            duracaoConsultaMin: true,
            calendarId: true,
            ativo: true,
          },
          orderBy: { nome: 'asc' },
        },
        _count: {
          select: { pacientes: true },
        },
      },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const fimMes    = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59);

    const agendamentosMes = await prisma.agendamento.count({
      where: { clinicaId: id, dataHora: { gte: inicioMes, lte: fimMes } },
    });

    const statusWhatsapp = await resolverStatusWhatsapp(clinica.telefoneWpp);

    return reply.send({
      success: true,
      data: {
        id: clinica.id,
        nome: clinica.nome,
        telefoneWpp: clinica.telefoneWpp,
        endereco: clinica.endereco,
        ativo: clinica.ativo,
        createdAt: clinica.createdAt,
        configJson: clinica.configJson,
        profissionais: clinica.profissionais,
        totalPacientes: clinica._count.pacientes,
        agendamentosMes,
        statusWhatsapp,
        googleCalendarConectado: !!clinica.googleRefreshToken,
      },
    });
  });

  /**
   * Alterna o status ativo/inativo da clínica.
   * Não apaga dados — apenas impede o bot de processar mensagens.
   */
  fastify.put('/owner/clinicas/:id/toggle', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { id } = request.params;

    const clinica = await prisma.clinica.findUnique({
      where: { id },
      select: { id: true, ativo: true },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    const atualizado = await prisma.clinica.update({
      where: { id },
      data: { ativo: !clinica.ativo },
      select: { id: true, ativo: true, nome: true },
    });

    return reply.send({ success: true, data: atualizado });
  });

  /**
   * Reseta a senha do admin da clínica.
   * Retorna a nova senha gerada (exibida uma única vez no frontend).
   */
  fastify.post('/owner/clinicas/:id/reset-senha', {
    preHandler: [fastify.authenticateOwner],
  }, async (request, reply) => {
    const { id } = request.params;

    const admin = await prisma.usuarioAdmin.findFirst({
      where: { clinicaId: id },
      orderBy: { createdAt: 'asc' },
    });

    if (!admin) {
      return reply.status(404).send({ success: false, error: 'Nenhum administrador encontrado para esta clínica' });
    }

    const novaSenha = gerarSenhaAleatoria(10);
    const novoHash  = await bcrypt.hash(novaSenha, 10);

    await prisma.usuarioAdmin.update({
      where: { id: admin.id },
      data: { senhaHash: novoHash },
    });

    return reply.send({
      success: true,
      data: { novaSenha },
    });
  });
}
