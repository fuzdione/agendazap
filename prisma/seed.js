import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');

  // Clínica principal de desenvolvimento
  const clinica = await prisma.clinica.upsert({
    where: { telefoneWpp: '5561999990001' },
    update: {},
    create: {
      nome: 'Clínica Saúde Plena',
      telefoneWpp: '5561999990001',
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

  // Profissionais — cria apenas se não existir
  const profissionaisData = [
    { nome: 'Dr. João Silva', especialidade: 'Clínico Geral', duracaoConsultaMin: 30 },
    { nome: 'Dra. Maria Santos', especialidade: 'Dermatologia', duracaoConsultaMin: 40 },
    { nome: 'Dra. Ana Costa', especialidade: 'Nutrição', duracaoConsultaMin: 50 },
  ];

  for (const dados of profissionaisData) {
    const existente = await prisma.profissional.findFirst({
      where: { clinicaId: clinica.id, nome: dados.nome },
    });

    if (!existente) {
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
    } else {
      console.log(`⏭️  Profissional já existe: ${dados.nome}`);
    }
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
