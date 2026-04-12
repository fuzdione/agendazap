import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

// Variáveis obrigatórias para o seed — falham explicitamente se ausentes
const CLINIC_PHONE = process.env.CLINIC_PHONE;
const CLINIC_NAME  = process.env.CLINIC_NAME  ?? 'Clínica Saúde Plena';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  ?? 'admin@clinicasaudeplena.com.br';
const ADMIN_SENHA  = process.env.ADMIN_SENHA  ?? 'admin123';

// Variáveis opcionais para o owner (proprietário da solução)
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const OWNER_SENHA = process.env.OWNER_SENHA;

if (!CLINIC_PHONE) {
  console.error('❌ CLINIC_PHONE não definido no .env — informe o número WhatsApp da clínica (ex: 5561999990000)');
  process.exit(1);
}

if (ADMIN_SENHA === 'admin123' && process.env.NODE_ENV === 'production') {
  console.error('❌ ADMIN_SENHA está com o valor padrão "admin123". Defina uma senha segura no .env antes de rodar o seed em produção.');
  process.exit(1);
}

if (OWNER_SENHA === 'admin123' && process.env.NODE_ENV === 'production') {
  console.error('❌ OWNER_SENHA está com o valor padrão "admin123". Defina uma senha segura no .env antes de rodar o seed em produção.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');
  console.log(`   📱 Telefone da clínica: ${CLINIC_PHONE}`);
  console.log(`   👤 Admin: ${ADMIN_EMAIL}`);

  // Clínica principal — usa o telefone real do WhatsApp para não criar duplicata.
  // Se a clínica já existe (criada automaticamente pelo webhook na primeira mensagem),
  // o upsert apenas retorna o registro existente sem sobrescrever nada.
  const clinica = await prisma.clinica.upsert({
    where: { telefoneWpp: CLINIC_PHONE },
    update: {},
    create: {
      nome: CLINIC_NAME,
      telefoneWpp: CLINIC_PHONE,
      endereco: 'SHLS 716, Sala 301 — Asa Sul, Brasília/DF',
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

  console.log(`✅ Clínica: ${clinica.nome} (${clinica.id})`);

  // Profissionais — só cria os de exemplo se a clínica ainda não tiver nenhum.
  // Se já existe ao menos 1 profissional (criado manualmente ou via bot), não toca em nada
  // para evitar duplicatas com durações diferentes.
  const totalProfissionais = await prisma.profissional.count({
    where: { clinicaId: clinica.id },
  });

  if (totalProfissionais === 0) {
    const profissionaisData = [
      { nome: 'Dr. João Silva', especialidade: 'Clínico Geral', duracaoConsultaMin: 30 },
      { nome: 'Dra. Maria Santos', especialidade: 'Dermatologia', duracaoConsultaMin: 40 },
      { nome: 'Dra. Ana Costa', especialidade: 'Nutrição', duracaoConsultaMin: 50 },
    ];

    for (const dados of profissionaisData) {
      const profissional = await prisma.profissional.create({
        data: {
          clinicaId: clinica.id,
          nome: dados.nome,
          especialidade: dados.especialidade,
          duracaoConsultaMin: dados.duracaoConsultaMin,
          ativo: true,
        },
      });
      console.log(`✅ Profissional criado: ${profissional.nome} — ${profissional.especialidade}`);
    }
  } else {
    console.log(`⏭️  Profissionais já cadastrados (${totalProfissionais}) — seed pulou criação`);
  }

  // Usuário admin do painel — criado via upsert para ser idempotente.
  // A senha vem de ADMIN_SENHA no .env. Em produção, essa variável é obrigatória.
  const senhaHash = await bcrypt.hash(ADMIN_SENHA, 10);
  const adminUser = await prisma.usuarioAdmin.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      clinicaId: clinica.id,
      email: ADMIN_EMAIL,
      senhaHash,
    },
  });
  console.log(`✅ Usuário admin: ${adminUser.email}`);

  // Owner da solução — criado apenas se OWNER_EMAIL e OWNER_SENHA estiverem definidos no .env
  if (OWNER_EMAIL && OWNER_SENHA) {
    const ownerSenhaHash = await bcrypt.hash(OWNER_SENHA, 10);
    const ownerUser = await prisma.usuarioOwner.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: {
        email: OWNER_EMAIL,
        senhaHash: ownerSenhaHash,
      },
    });
    console.log(`✅ Usuário owner: ${ownerUser.email}`);
  } else {
    console.log('⏭️  OWNER_EMAIL/OWNER_SENHA não definidos — seed do owner pulado');
  }

  console.log('🎉 Seed concluído com sucesso!');
}

main()
  .catch((err) => {
    console.error('❌ Erro no seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
