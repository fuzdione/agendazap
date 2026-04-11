import { prisma } from '../../config/database.js';

/**
 * Rota de configurações da clínica no painel administrativo.
 */
export async function configuracoesRoutes(fastify) {
  /**
   * Retorna as configurações atuais da clínica.
   */
  fastify.get('/admin/configuracoes', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
      select: { id: true, nome: true, telefoneWpp: true, endereco: true, configJson: true },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    return reply.send({ success: true, data: clinica });
  });

  /**
   * Atualiza o config_json da clínica (horários, mensagens, telefone de fallback).
   * Faz merge com o config existente — campos não enviados são preservados.
   */
  fastify.put('/admin/configuracoes', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          nome:    { type: 'string', minLength: 1 },
          endereco: { type: 'string' },
          configJson: {
            type: 'object',
            properties: {
              horario_funcionamento: {
                type: 'object',
                properties: {
                  seg_sex: {
                    type: 'object',
                    properties: {
                      inicio: { type: 'string' },
                      fim:    { type: 'string' },
                    },
                  },
                  sab: {
                    type: 'object',
                    properties: {
                      inicio: { type: 'string' },
                      fim:    { type: 'string' },
                    },
                  },
                },
              },
              telefone_fallback:    { type: 'string' },
              mensagem_boas_vindas: { type: 'string' },
              intervalo_slots_min:  { type: 'integer', minimum: 5 },
            },
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const clinicaId = request.user.clinicaId;
    const { nome, endereco, configJson } = request.body;

    const clinicaAtual = await prisma.clinica.findUnique({
      where: { id: clinicaId },
      select: { configJson: true },
    });

    if (!clinicaAtual) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    // Merge do configJson — preserva campos existentes não enviados
    const configMerged = configJson
      ? { ...(clinicaAtual.configJson ?? {}), ...configJson }
      : clinicaAtual.configJson;

    const data = { configJson: configMerged };
    if (nome)     data.nome = nome;
    if (endereco !== undefined) data.endereco = endereco;

    const clinicaAtualizada = await prisma.clinica.update({
      where: { id: clinicaId },
      data,
      select: { id: true, nome: true, telefoneWpp: true, endereco: true, configJson: true },
    });

    return reply.send({ success: true, data: clinicaAtualizada });
  });
}
