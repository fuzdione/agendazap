import { getAuthUrl, handleCallback } from '../../config/google.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';

/**
 * Rotas para o fluxo OAuth2 do Google Calendar.
 * O admin da clínica acessa /admin/google/auth/:clinicaId, é redirecionado para o
 * consentimento do Google, e volta para /admin/google/callback com o code.
 */
export async function googleAuthRoutes(fastify) {
  /**
   * Inicia o fluxo OAuth: redireciona o admin para a tela de consentimento do Google.
   * O clinicaId é passado no state para ser recuperado no callback.
   */
  fastify.get('/admin/google/auth/:clinicaId', async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    const url = getAuthUrl(clinicaId);
    return reply.redirect(url);
  });

  /**
   * Callback OAuth: recebe o code do Google, troca pelo refresh_token e salva no banco.
   * Redireciona para o painel com indicação de sucesso ou erro.
   */
  fastify.get('/admin/google/callback', async (request, reply) => {
    const { code, state: clinicaId, error } = request.query;

    // Usuário negou acesso na tela de consentimento
    if (error) {
      request.log.warn({ msg: 'OAuth negado pelo usuário', error });
      return reply.redirect(`${env.ADMIN_URL ?? 'http://localhost:5173'}?google_auth=denied`);
    }

    if (!code || !clinicaId) {
      return reply.status(400).send({ success: false, error: 'Parâmetros inválidos no callback' });
    }

    try {
      await handleCallback(code, clinicaId);
      request.log.info({ msg: 'Google Calendar autorizado', clinicaId });

      // Redireciona de volta ao painel com flag de sucesso
      return reply.redirect(`${env.ADMIN_URL ?? 'http://localhost:5173'}?google_auth=success&clinicaId=${clinicaId}`);
    } catch (err) {
      request.log.error({ msg: 'Erro no callback OAuth Google', error: err.message });
      return reply.redirect(`${env.ADMIN_URL ?? 'http://localhost:5173'}?google_auth=error`);
    }
  });

  /**
   * Retorna se a clínica tem o Google Calendar conectado (refresh_token salvo).
   */
  fastify.get('/admin/google/status/:clinicaId', async (request, reply) => {
    const { clinicaId } = request.params;

    const clinica = await prisma.clinica.findUnique({
      where: { id: clinicaId },
      select: { googleRefreshToken: true },
    });

    if (!clinica) {
      return reply.status(404).send({ success: false, error: 'Clínica não encontrada' });
    }

    return reply.send({
      success: true,
      data: { conectado: Boolean(clinica.googleRefreshToken) },
    });
  });
}
