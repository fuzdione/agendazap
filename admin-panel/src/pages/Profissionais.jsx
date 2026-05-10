import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { Plus, Pencil, Trash2, Link, X, IdCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const INICIAL = { nome: '', especialidade: '', duracaoConsultaMin: 30, atendeParticular: true, ativo: true };

export default function Profissionais() {
  const { clinica } = useAuth();
  const [profissionais, setProfissionais] = useState([]);
  const [conveniosClinica, setConveniosClinica] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalCalendar, setModalCalendar] = useState(null);
  const [modalConvenios, setModalConvenios] = useState(null); // profissional para gerenciar convênios
  const [calendarios, setCalendarios] = useState([]);
  const [carregandoCal, setCarregandoCal] = useState(false);
  const [form, setForm] = useState(INICIAL);
  const [editandoId, setEditandoId] = useState(null);
  const [conveniosSelecionados, setConveniosSelecionados] = useState([]); // IDs selecionados no modal de convênios
  const [salvando, setSalvando] = useState(false);
  const [salvandoConvenios, setSalvandoConvenios] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    try {
      setLoading(true);
      const [{ data: profData }, { data: convData }] = await Promise.all([
        api.get('/admin/profissionais'),
        api.get('/admin/convenios'),
      ]);
      setProfissionais(profData.data);
      setConveniosClinica(convData.data.filter((c) => c.ativo));
    } catch {
      setErro('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  function abrirModal(profissional = null) {
    if (profissional) {
      setEditandoId(profissional.id);
      setForm({
        nome: profissional.nome,
        especialidade: profissional.especialidade,
        duracaoConsultaMin: profissional.duracaoConsultaMin,
        atendeParticular: profissional.atendeParticular !== false,
        ativo: profissional.ativo,
      });
    } else {
      setEditandoId(null);
      setForm(INICIAL);
    }
    setErro('');
    setModalAberto(true);
  }

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      if (editandoId) {
        await api.put(`/admin/profissionais/${editandoId}`, form);
      } else {
        await api.post('/admin/profissionais', form);
      }
      setModalAberto(false);
      await carregar();
    } catch (err) {
      setErro(err.response?.data?.error ?? 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function desativar(id) {
    if (!confirm('Desativar este profissional?')) return;
    try {
      await api.delete(`/admin/profissionais/${id}`);
      await carregar();
    } catch {
      alert('Erro ao desativar profissional');
    }
  }

  async function abrirModalCalendar(profissional) {
    setModalCalendar(profissional);
    setCarregandoCal(true);
    setCalendarios([]);
    try {
      const { data } = await api.get(`/admin/calendars/${clinica.id}`);
      setCalendarios(data.data);
    } catch (err) {
      alert(err.response?.data?.error ?? 'Erro ao listar calendários');
      setModalCalendar(null);
    } finally {
      setCarregandoCal(false);
    }
  }

  async function vincularCalendar(calendarId) {
    try {
      await api.put(`/admin/profissionais/${modalCalendar.id}/calendar`, { calendarId });
      setModalCalendar(null);
      await carregar();
    } catch {
      alert('Erro ao vincular calendário');
    }
  }

  function abrirModalConvenios(profissional) {
    setModalConvenios(profissional);
    setConveniosSelecionados((profissional.convenios ?? []).map((c) => c.id));
    setErro('');
  }

  function toggleConvenio(id) {
    setConveniosSelecionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function salvarConvenios() {
    if (!modalConvenios) return;
    setSalvandoConvenios(true);
    try {
      await api.put(`/admin/profissionais/${modalConvenios.id}/convenios`, {
        convenioIds: conveniosSelecionados,
      });
      setModalConvenios(null);
      await carregar();
    } catch {
      setErro('Erro ao salvar convênios');
    } finally {
      setSalvandoConvenios(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Profissionais</h1>
        <button
          onClick={() => abrirModal()}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          Novo profissional
        </button>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {profissionais.length === 0 ? (
          <div className="py-14 text-center text-gray-400 text-sm">Nenhum profissional cadastrado.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {profissionais.map((p) => (
              <div key={p.id} className="px-4 sm:px-5 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
                  {/* Bloco principal: nome, especialidade, badges */}
                  <div className="flex-1 min-w-0">
                    {/* Nome + status (status só inline no mobile) */}
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <p className="font-medium text-gray-900 truncate">{p.nome}</p>
                      <span className={`sm:hidden flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{p.especialidade} · {p.duracaoConsultaMin} min</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.atendeParticular !== false && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Particular</span>
                      )}
                      {(p.convenios ?? []).map((c) => (
                        <span key={c.id} className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{c.nome}</span>
                      ))}
                      {p.calendarId && (
                        <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">Calendar</span>
                      )}
                    </div>
                  </div>

                  {/* Status — só desktop (no mobile aparece ao lado do nome acima) */}
                  <span className={`hidden sm:inline-block flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {p.ativo ? 'Ativo' : 'Inativo'}
                  </span>

                  {/* Ações — separadas por linha sutil no mobile */}
                  <div className="flex items-center justify-end gap-1 sm:gap-2 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100 flex-shrink-0">
                    {conveniosClinica.length > 0 && (
                      <button
                        onClick={() => abrirModalConvenios(p)}
                        title="Gerenciar convênios"
                        className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                      >
                        <IdCard size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => abrirModalCalendar(p)}
                      title="Vincular Google Calendar"
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Link size={16} />
                    </button>
                    <button
                      onClick={() => abrirModal(p)}
                      title="Editar"
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    {p.ativo && (
                      <button
                        onClick={() => desativar(p.id)}
                        title="Desativar"
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal criar/editar */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {editandoId ? 'Editar profissional' : 'Novo profissional'}
              </h2>
              <button onClick={() => setModalAberto(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {erro && (
              <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {erro}
              </div>
            )}

            <form onSubmit={salvar} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  required
                  value={form.nome}
                  onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Especialidade</label>
                <input
                  required
                  value={form.especialidade}
                  onChange={(e) => setForm((p) => ({ ...p, especialidade: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duração da consulta (min)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  required
                  value={form.duracaoConsultaMin}
                  onChange={(e) => setForm((p) => ({ ...p, duracaoConsultaMin: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="atendeParticular"
                  checked={form.atendeParticular}
                  onChange={(e) => setForm((p) => ({ ...p, atendeParticular: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
                <label htmlFor="atendeParticular" className="text-sm text-gray-700">Atende particular</label>
              </div>
              {editandoId && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ativo"
                    checked={form.ativo}
                    onChange={(e) => setForm((p) => ({ ...p, ativo: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <label htmlFor="ativo" className="text-sm text-gray-700">Profissional ativo</label>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal convênios do profissional */}
      {modalConvenios && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col p-6">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Convênios atendidos</h2>
              <button onClick={() => setModalConvenios(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4 flex-shrink-0">
              Selecione os convênios que <strong>{modalConvenios.nome}</strong> atende:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 mb-5 overflow-y-auto pr-1 flex-1 min-h-0">
              {conveniosClinica.map((c) => (
                <label key={c.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={conveniosSelecionados.includes(c.id)}
                    onChange={() => toggleConvenio(c.id)}
                    className="w-4 h-4 accent-purple-600 flex-shrink-0"
                  />
                  <span className="text-sm text-gray-800 truncate">{c.nome}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 flex-shrink-0 pt-3 border-t border-gray-100">
              <button
                onClick={() => setModalConvenios(null)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={salvarConvenios}
                disabled={salvandoConvenios}
                className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {salvandoConvenios ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal calendários */}
      {modalCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Vincular Google Calendar</h2>
              <button onClick={() => setModalCalendar(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Escolha o calendário para <strong>{modalCalendar.nome}</strong>:
            </p>
            {carregandoCal ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-7 h-7 border-4 border-emerald-500 border-t-transparent rounded-full" />
              </div>
            ) : calendarios.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum calendário encontrado.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {calendarios.map((cal) => (
                  <button
                    key={cal.id}
                    onClick={() => vincularCalendar(cal.id)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-800">{cal.summary}</p>
                    {cal.primary && <p className="text-xs text-gray-400">Calendário principal</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
