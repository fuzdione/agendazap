import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';

/**
 * Rota de autenticação do painel do proprietário.
 * Valida e-mail e senha, retorna JWT com { sub: ownerId, role: "owner" }.
 */
export async function ownerAuthRoutes(fastify) {
  fastify.post('/owner/auth/login', {
    config: {
      rateLimit: {
        max: 5,
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

    const owner = await prisma.usuarioOwner.findUnique({
      where: { email },
    });

    if (!owner) {
      return reply.status(401).send({ success: false, error: 'Credenciais inválidas' });
    }

    const senhaValida = await bcrypt.compare(senha, owner.senhaHash);
    if (!senhaValida) {
      return reply.status(401).send({ success: false, error: 'Credenciais inválidas' });
    }

    const token = fastify.jwt.sign(
      { sub: owner.id, role: 'owner' },
      { expiresIn: '8h' },
    );

    return reply.send({
      success: true,
      data: {
        token,
        usuario: { id: owner.id, email: owner.email },
      },
    });
  });
}
