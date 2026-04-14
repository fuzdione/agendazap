import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, Filter } from 'lucide-react';

const STATUS_CONFIG = {
  agendado:   { label: 'Agendado',   cls: 'bg-yellow-100 text-yellow-700' },
  confirmado: { label: 'Confirmado', cls: 'bg-emerald-100 text-emerald-700' },
  cancelado:  { label: 'Cancelado',  cls: 'bg-red-100 text-red-700' },
  concluido:  { label: 'Concluído',  cls: 'bg-blue-100 text-blue-700' },
  no_show:    { label: 'No-show',    cls: 'bg-orange-100 text-orange-700' },
};

const ACOES_POR_STATUS = {
  agendado:   ['confirmado', 'cancelado'],
  confirmado: ['concluido', 'no_show', 'cancelado'],
  concluido:  [],
  no_show:    [],
  cancelado:  [],
};

const LABEL_ACAO = {
  confirmado: 'Confirmar',
  concluido:  'Concluir',
  no_show:    'No-show',
  cancelado:  'Cancelar',
};

const COR_ACAO = {
  confirmado: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  concluido:  'bg-blue-50 text-blue-700 hover:bg-blue-100',
  no_show:    'bg-orange-50 text-orange-700 hover:bg-orange-100',
  cancelado:  'bg-red-50 text-red-700 hover:bg-red-100',
};

export default function Agendamentos() {
  const [agendamentos, setAgendamentos] = useState([]);
  const [paginacao, setPaginacao] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState({});
  const [profissionais, setProfissionais] = useState([]);

  const [filtros, setFiltros] = useState({
    data_inicio: '',
    data_fim: '',
    profissional_id: '',
    status: '',
    page: 1,
  });

  useEffect(() => {
    carregarProfissionais();
  }, []);

  useEffect(() => {
    carregarAgendamentos();
  }, [filtros]);

  async function carregarProfissionais() {
    try {
      const { data } = await api.get('/admin/profissionais');
      setProfissionais(data.data);
    } catch {
      // silencia erro de profissionais
    }
  }

  async function carregarAgendamentos() {
    try {
      setLoading(true);
      const params = { ...filtros };
      // Remove filtros vazios
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const { data } = await api.get('/admin/agendamentos', { params });
      setAgendamentos(data.data.agendamentos);
      setPaginacao(data.data.paginacao);
    } catch {
      // silencia
    } finally {
      setLoading(false);
    }
  }

  async function atualizarStatus(id, status) {
    setAtualizando((p) => ({ ...p, [id]: true }));
    try {
      await api.put(`/admin/agendamentos/${id}/status`, { status });
      await carregarAgendamentos();
    } catch {
      alert('Erro ao atualizar status');
    } finally {
      setAtualizando((p) => ({ ...p, [id]: false }));
    }
  }

  function setFiltro(campo, valor) {
    setFiltros((p) => ({ ...p, [campo]: valor, page: 1 }));
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Agendamentos</h1>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-600">Filtros</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Data início</label>
            <input
              type="date"
              value={filtros.data_inicio}
              onChange={(e) => setFiltro('data_inicio', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Data fim</label>
            <input
              type="date"
              value={filtros.data_fim}
              onChange={(e) => setFiltro('data_fim', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Profissional</label>
            <select
              value={filtros.profissional_id}
              onChange={(e) => setFiltro('profissional_id', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Todos</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select
              value={filtros.status}
              onChange={(e) => setFiltro('status', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">{paginacao.total} agendamento(s)</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin w-7 h-7 border-4 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : agendamentos.length === 0 ? (
          <div className="py-14 text-center text-gray-400 text-sm">Nenhum agendamento encontrado.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-5 py-3 font-medium">Data / Hora</th>
                    <th className="px-5 py-3 font-medium">Paciente</th>
                    <th className="px-5 py-3 font-medium">Profissional</th>
                    <th className="px-5 py-3 font-medium">Duração</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {agendamentos.map((ag) => {
                    const st = STATUS_CONFIG[ag.status] ?? { label: ag.status, cls: 'bg-gray-100 text-gray-700' };
                    const acoes = ACOES_POR_STATUS[ag.status] ?? [];
                    return (
                      <tr key={ag.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 whitespace-nowrap">
                          {format(new Date(ag.dataHora), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-800">{ag.paciente?.nome ?? '—'}</p>
                          <p className="text-xs text-gray-400">{ag.paciente?.telefone}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p>{ag.profissional?.nome}</p>
                          <p className="text-xs text-gray-400">{ag.profissional?.especialidade}</p>
                        </td>
                        <td className="px-5 py-3 text-gray-500">{ag.duracaoMin} min</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                            {st.label}
                          </span>
                          {ag.status === 'confirmado' && ag.confirmedBy && (
                            <span className={`ml-1 px-1.5 py-0.5 rounded text-xs ${ag.confirmedBy === 'paciente' ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-violet-600'}`}>
                              {ag.confirmedBy === 'paciente' ? '📱 paciente' : '🖥️ admin'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {acoes.map((acao) => (
                              <button
                                key={acao}
                                disabled={!!atualizando[ag.id]}
                                onClick={() => atualizarStatus(ag.id, acao)}
                                className={`px-2 py-1 text-xs rounded disabled:opacity-40 transition-colors ${COR_ACAO[acao]}`}
                              >
                                {atualizando[ag.id] ? '...' : LABEL_ACAO[acao]}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {paginacao.totalPages > 1 && (
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  Página {paginacao.page} de {paginacao.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={paginacao.page <= 1}
                    onClick={() => setFiltros((p) => ({ ...p, page: p.page - 1 }))}
                    className="px-3 py-1 border rounded text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                  >
                    Anterior
                  </button>
                  <button
                    disabled={paginacao.page >= paginacao.totalPages}
                    onClick={() => setFiltros((p) => ({ ...p, page: p.page + 1 }))}
                    className="px-3 py-1 border rounded text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
