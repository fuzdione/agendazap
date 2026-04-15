import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, CalendarCheck2, TrendingUp, Clock } from 'lucide-react';

const STATUS_LABEL = {
  agendado:   { label: 'Agendado',   cls: 'bg-yellow-100 text-yellow-700' },
  confirmado: { label: 'Confirmado', cls: 'bg-emerald-100 text-emerald-700' },
  cancelado:  { label: 'Cancelado',  cls: 'bg-red-100 text-red-700' },
  concluido:  { label: 'Concluído',  cls: 'bg-blue-100 text-blue-700' },
  no_show:    { label: 'No-show',    cls: 'bg-orange-100 text-orange-700' },
};

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [atualizando, setAtualizando] = useState({});

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    try {
      setLoading(true);
      const { data } = await api.get('/admin/dashboard');
      setDados(data.data);
    } catch {
      setErro('Erro ao carregar dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function atualizarStatus(id, status) {
    setAtualizando((prev) => ({ ...prev, [id]: true }));
    try {
      await api.put(`/admin/agendamentos/${id}/status`, { status });
      await carregarDados();
    } catch {
      alert('Erro ao atualizar status');
    } finally {
      setAtualizando((prev) => ({ ...prev, [id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (erro) {
    return (
      <div className="text-center py-16 text-red-500">{erro}</div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={CalendarDays}
          label="Agendamentos hoje"
          value={dados.agendamentosHoje}
          color="bg-emerald-500"
        />
        <StatCard
          icon={CalendarCheck2}
          label="Agendamentos na semana"
          value={dados.agendamentosSemana}
          color="bg-blue-500"
        />
        <StatCard
          icon={TrendingUp}
          label="Taxa de confirmação"
          value={`${dados.taxaConfirmacao}%`}
          sub="Últimos 30 dias"
          color="bg-violet-500"
        />
      </div>

      {/* Próximos agendamentos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={18} className="text-gray-400" />
          <h2 className="font-semibold text-gray-800">Próximos agendamentos</h2>
        </div>

        {dados.proximosAgendamentos.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            Nenhum agendamento confirmado próximo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-5 py-3 font-medium">Data / Hora</th>
                  <th className="px-5 py-3 font-medium">Paciente</th>
                  <th className="px-5 py-3 font-medium">Profissional</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dados.proximosAgendamentos.map((ag) => {
                  const st = STATUS_LABEL[ag.status] ?? { label: ag.status, cls: 'bg-gray-100 text-gray-700' };
                  return (
                    <tr key={ag.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap">
                        {format(new Date(ag.dataHora), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{ag.paciente?.nome ?? '—'}</p>
                        <p className="text-xs text-gray-400">{ag.paciente?.telefone}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p>{ag.profissional?.nome}</p>
                        <p className="text-xs text-gray-400">{ag.profissional?.especialidade}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2">
                          <button
                            disabled={atualizando[ag.id] || ag.status === 'concluido'}
                            onClick={() => atualizarStatus(ag.id, 'concluido')}
                            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 rounded transition-colors"
                          >
                            Concluir
                          </button>
                          <button
                            disabled={atualizando[ag.id] || ag.status === 'cancelado'}
                            onClick={() => atualizarStatus(ag.id, 'cancelado')}
                            className="px-2 py-1 text-xs bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40 rounded transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
