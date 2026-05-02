import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock, MessageSquare, CalendarRange, AlertCircle } from 'lucide-react';

const STATUS_LABEL = {
  agendado:   { label: 'Agendado',   cls: 'bg-yellow-100 text-yellow-700' },
  confirmado: { label: 'Confirmado', cls: 'bg-emerald-100 text-emerald-700' },
  cancelado:  { label: 'Cancelado',  cls: 'bg-red-100 text-red-700' },
  concluido:  { label: 'Concluído',  cls: 'bg-blue-100 text-blue-700' },
  no_show:    { label: 'No-show',    cls: 'bg-orange-100 text-orange-700' },
};

/** Pílula de status pequena, usada no breakdown de "Hoje" */
function StatusPill({ count, label, color, icon = null }) {
  return (
    <div className={`flex-1 min-w-[80px] rounded-lg px-3 py-2 ${color}`}>
      <div className="flex items-center gap-1 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <p className="text-xl font-bold mt-0.5">{count}</p>
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
    return <div className="text-center py-16 text-red-500">{erro}</div>;
  }

  const hoje = dados.hojeBreakdown ?? { total: 0, confirmado: 0, agendado: 0, concluido: 0, cancelado: 0, noShow: 0 };
  const naoConfirmados = hoje.agendado;
  const dataDeHoje = format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR });

  // Para o gráfico — encontra valor máximo para escala proporcional
  const maxSemana = Math.max(...(dados.agendamentosPorDia ?? []).map((d) => d.count), 1);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* ── Bloco HOJE — destaque máximo ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Hoje</p>
            <p className="text-lg font-semibold text-gray-900 capitalize">{dataDeHoje}</p>
          </div>
          {dados.proximas2h > 0 && (
            <div className="flex items-center gap-2 bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg text-sm font-medium">
              <Clock size={15} />
              {dados.proximas2h} {dados.proximas2h === 1 ? 'consulta' : 'consultas'} nas próximas 2h
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <StatusPill count={hoje.total} label="Total"      color="bg-gray-50 text-gray-800" />
          <StatusPill count={hoje.confirmado} label="Confirmados" color="bg-emerald-50 text-emerald-700" />
          <StatusPill count={hoje.agendado}   label="Aguardando"  color="bg-yellow-50 text-yellow-700" />
          <StatusPill count={hoje.concluido}  label="Concluídos"  color="bg-blue-50 text-blue-700" />
          <StatusPill count={hoje.cancelado + hoje.noShow} label="Cancel./No-show" color="bg-red-50 text-red-700" />
        </div>

        {naoConfirmados > 0 && (
          <div className="mt-4 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-sm text-yellow-800">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>
              <strong>{naoConfirmados}</strong> {naoConfirmados === 1 ? 'consulta ainda não confirmou' : 'consultas ainda não confirmaram'} a presença — vale ligar para o paciente.
            </p>
          </div>
        )}
      </div>

      {/* ── Linha com 2 cards: Esta semana (gráfico) + Bot ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mini gráfico da semana */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarRange size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-800 text-sm">Esta semana</h2>
            </div>
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-700">{dados.agendamentosSemana}</span> agendamentos
            </p>
          </div>
          <div className="flex items-end gap-2 h-32 mt-4">
            {(dados.agendamentosPorDia ?? []).map((d) => {
              const heightPct = (d.count / maxSemana) * 100;
              return (
                <div key={d.data} className="flex flex-col items-center flex-1 gap-1.5 min-w-0">
                  <span className={`text-xs font-medium ${d.count > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                    {d.count}
                  </span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-md transition-colors ${
                        d.isToday ? 'bg-emerald-500' : 'bg-emerald-200'
                      }`}
                      style={{
                        height: d.count > 0 ? `${Math.max(heightPct, 8)}%` : '2px',
                      }}
                      title={`${d.count} agendamento(s)`}
                    />
                  </div>
                  <span className={`text-xs ${d.isToday ? 'text-emerald-700 font-semibold' : 'text-gray-500'}`}>
                    {d.diaSemana}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Saúde do bot */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-800 text-sm">Bot hoje</h2>
          </div>
          <div className="space-y-3 mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-gray-500">Conversas iniciadas</span>
              <span className="text-2xl font-bold text-gray-900">{dados.botHoje?.conversas ?? 0}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-gray-500">Agendamentos criados</span>
              <span className="text-2xl font-bold text-emerald-600">{dados.botHoje?.agendamentosCriados ?? 0}</span>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Taxa de confirmação 30d: <strong className="text-gray-700">{dados.taxaConfirmacao}%</strong>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Próximos agendamentos com botões inline ── */}
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
