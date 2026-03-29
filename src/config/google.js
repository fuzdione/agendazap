import { google } from 'googleapis';
import { env } from './env.js';
import { prisma } from './database.js';

/**
 * Cria um cliente OAuth2 base (sem token — usado para gerar URLs e trocar codes).
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Gera a URL de consentimento OAuth para o admin de uma clínica autorizar acesso ao Google Calendar.
 *
 * @param {string} clinicaId - Incluído no `state` para identificar a clínica no callback
 * @returns {string} URL de redirecionamento para o Google
 */
export function getAuthUrl(clinicaId) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',  // garante retorno do refresh_token
    prompt: 'consent',       // força exibição mesmo que já autorizado antes
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: clinicaId,
  });
}

/**
 * Troca o code de autorização pelo access_token e refresh_token.
 * Salva o refresh_token no banco da clínica para reutilização futura.
 *
 * @param {string} code - Code retornado pelo Google no callback
 * @param {string} clinicaId - ID da clínica que está autorizando
 * @returns {object} Tokens retornados pelo Google
 */
export async function handleCallback(code, clinicaId) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  // Persiste apenas o refresh_token — o access_token expira em ~1h e é renovado automaticamente
  if (tokens.refresh_token) {
    await prisma.clinica.update({
      where: { id: clinicaId },
      data: { googleRefreshToken: tokens.refresh_token },
    });
  }

  return tokens;
}

/**
 * Retorna um cliente OAuth2 autenticado para uma clínica.
 * Usa o refresh_token salvo no banco para obter um access_token válido.
 * Lança erro se a clínica não tiver autorizado o Google Calendar.
 *
 * @param {string} clinicaId
 * @returns {google.auth.OAuth2} Cliente autenticado pronto para usar com googleapis
 */
export async function getAuthenticatedClient(clinicaId) {
  const clinica = await prisma.clinica.findUnique({
    where: { id: clinicaId },
    select: { googleRefreshToken: true },
  });

  if (!clinica?.googleRefreshToken) {
    const err = new Error(`Clínica ${clinicaId} não tem Google Calendar autorizado`);
    err.code = 'GOOGLE_NOT_AUTHORIZED';
    throw err;
  }

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: clinica.googleRefreshToken });

  // Força renovação do access_token antes de usar (evita race condition com expiração)
  await client.getAccessToken();

  return client;
}
