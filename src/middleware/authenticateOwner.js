/**
 * Decorator Fastify para autenticação do proprietário da solução (owner).
 * Valida o JWT e exige que o claim role seja "owner".
 * Registrar via: fastify.decorate('authenticateOwner', authenticateOwner)
 */
export async function authenticateOwner(request, reply) {
  try {
    await request.jwtVerify();

    if (request.user.role !== 'owner') {
      return reply.status(401).send({ success: false, error: 'Acesso não autorizado' });
    }
  } catch (err) {
    return reply.status(401).send({ success: false, error: 'Token inválido ou expirado' });
  }
}
