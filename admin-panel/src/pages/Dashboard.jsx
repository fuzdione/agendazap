import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { format, isToday, isTomorrow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock, MessageSquare, CalendarRange, AlertCircle, PieChart, Trophy } from 'lucide-react';

// Paleta usada nas barras do mix particular/convênio.
// Particular fica fixo no azul; convênios pegam as próximas cores em ordem.
const MIX_PARTICULAR_COLOR = 'bg-blue-500';
const MIX_CONVENIO_COLORS = [
  'bg-purple-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-lime-500',
  'bg-cyan-500',
];

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
  const [filtroPeriodo, setFiltroPeriodo] = useState('hoje'); // 'hoje' | 'amanha' | '7dias'

  useEffect(() => {
    carregarDados();
  }, []);

  // Filtro Hoje / Amanhã / Próximos 7 dias — feito client-side no array já carregado.
  // IMPORTANTE: este useMemo precisa ficar antes dos early returns (if loading / if erro)
  // para não violar as Rules of Hooks (mudança de ordem entre renders quebra a tela).
  const proximosFiltrados = useMemo(() => {
    const lista = dados?.proximosAgendamentos ?? [];
    if (filtroPeriodo === '7dias') return lista;
    return lista.filter((ag) => {
      const dt = new Date(ag.dataHora);
      if (filtroPeriodo === 'hoje') return isToday(dt);
      if (filtroPeriodo === 'amanha') return isTomorrow(dt);
      return true;
    });
  }, [dados, filtroPeriodo]);

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

  // Para o gráfico semanal — escala proporcional ao maior dia
  const maxSemana = Math.max(...(dados.agendamentosPorDia ?? []).map((d) => d.count), 1);

  // Mix particular/convênio — só renderiza o card quando há convênios envolvidos
  const mix = dados.mixConsulta ?? { total: 0, particular: 0, convenios: [] };
  const temMixDeConvenios = mix.convenios.length > 0;

  // Top profissionais da semana — escala proporcional ao topo
  const topProfs = dados.topProfissionais ?? [];
  const maxTopProf = Math.max(...topProfs.map((p) => p.count), 1);

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

      {/* ── Linha: Mix de atendimento + Top profissionais ── */}
      <div className={`grid grid-cols-1 ${temMixDeConvenios ? 'lg:grid-cols-2' : ''} gap-4`}>
        {/* Mix particular/convênio (oculto se a clínica não tem convênios) */}
        {temMixDeConvenios && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PieChart size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-800 text-sm">Mix de atendimento (30d)</h2>
              </div>
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{mix.total}</span> consultas
              </p>
            </div>

            {mix.total === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Sem dados nos últimos 30 dias.</p>
            ) : (
              <>
                {/* Barra horizontal empilhada */}
                <div className="h-3 rounded-full overflow-hidden flex bg-gray-100 mt-3">
                  {mix.particular > 0 && (
                    <div
                      className={MIX_PARTICULAR_COLOR}
                      style={{ width: `${(mix.particular / mix.total) * 100}%` }}
                      title={`Particular: ${mix.particular}`}
                    />
                  )}
                  {mix.convenios.map((c, i) => (
                    <div
                      key={c.nome}
                      className={MIX_CONVENIO_COLORS[i % MIX_CONVENIO_COLORS.length]}
                      style={{ width: `${(c.count / mix.total) * 100}%` }}
                      title={`${c.nome}: ${c.count}`}
                    />
                  ))}
                </div>

                {/* Legenda */}
                <div className="space-y-1.5 mt-4">
                  {mix.particular > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-3 h-3 rounded ${MIX_PARTICULAR_COLOR} flex-shrink-0`} />
                        <span className="text-gray-700 truncate">Particular</span>
                      </div>
                      <span className="text-gray-500 flex-shrink-0 ml-2">
                        {mix.particular} <span className="text-gray-400">({Math.round((mix.particular / mix.total) * 100)}%)</span>
                      </span>
                    </div>
                  )}
                  {mix.convenios.map((c, i) => (
                    <div key={c.nome} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-3 h-3 rounded ${MIX_CONVENIO_COLORS[i % MIX_CONVENIO_COLORS.length]} flex-shrink-0`} />
                        <span className="text-gray-700 truncate">{c.nome}</span>
                      </div>
                      <span className="text-gray-500 flex-shrink-0 ml-2">
                        {c.count} <span className="text-gray-400">({Math.round((c.count / mix.total) * 100)}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Top profissionais da semana */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-800 text-sm">Profissionais da semana</h2>
            </div>
          </div>

          {topProfs.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Sem agendamentos esta semana.</p>
          ) : (
            <div className="space-y-3 mt-3">
              {topProfs.map((p, i) => {
                const pct = (p.count / maxTopProf) * 100;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-400 w-5 flex-shrink-0">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.nome}</p>
                      <p className="text-xs text-gray-500 truncate">{p.especialidade}</p>
                      <div className="bg-gray-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
                        <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 w-8 text-right flex-shrink-0">{p.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Próximos agendamentos com filtro de período + botões inline ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-gray-400" />
            <h2 className="font-semibold text-gray-800">Próximos agendamentos</h2>
          </div>

          {/* Tabs de período */}
          <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg text-xs">
            {[
              { value: 'hoje',   label: 'Hoje' },
              { value: 'amanha', label: 'Amanhã' },
              { value: '7dias',  label: 'Próximos 7 dias' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFiltroPeriodo(opt.value)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  filtroPeriodo === opt.value
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {proximosFiltrados.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            {filtroPeriodo === 'hoje'   && 'Nenhuma consulta marcada para hoje.'}
            {filtroPeriodo === 'amanha' && 'Nenhuma consulta marcada para amanhã.'}
            {filtroPeriodo === '7dias'  && 'Nenhuma consulta nos próximos 7 dias.'}
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
                {proximosFiltrados.map((ag) => {
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
