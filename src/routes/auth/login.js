import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';

/**
 * Rota de autenticação do painel administrativo.
 * Valida e-mail e senha, retorna JWT com { sub: userId, clinicaId }.
 */
export async function authRoutes(fastify) {
  fastify.post('/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          success: false,
          error: 'Muitas tentativas de login. Aguarde 1 minuto e tente novamente.',
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'senha'],
        properties: {
          email: { type: 'string', format: 'email' },
          senha: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, senha } = request.body;

    const usuario = await prisma.usuarioAdmin.findUnique({
      where: { email },
      include: { clinica: { select: { id: true, nome: true, ativo: true } } },
    });

    if (!usuario || !usuario.clinica.ativo) {
      return reply.status(401).send({ success: false, error: 'Credenciais inválidas' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaValida) {
      return reply.status(401).send({ success: false, error: 'Credenciais inválidas' });
    }

    const token = fastify.jwt.sign(
      { sub: usuario.id, clinicaId: usuario.clinicaId },
      { expiresIn: '8h' },
    );

    return reply.send({
      success: true,
      data: {
        token,
        usuario: { id: usuario.id, email: usuario.email },
        clinica: { id: usuario.clinica.id, nome: usuario.clinica.nome },
      },
    });
  });
}
