import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { Plus, Pencil, Trash2, Link, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const INICIAL = { nome: '', especialidade: '', duracaoConsultaMin: 30, ativo: true };

export default function Profissionais() {
  const { clinica } = useAuth();
  const [profissionais, setProfissionais] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalCalendar, setModalCalendar] = useState(null); // profissional selecionado para vinculação
  const [calendarios, setCalendarios] = useState([]);
  const [carregandoCal, setCarregandoCal] = useState(false);
  const [form, setForm] = useState(INICIAL);
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    try {
      setLoading(true);
      const { data } = await api.get('/admin/profissionais');
      setProfissionais(data.data);
    } catch {
      setErro('Erro ao carregar profissionais');
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
              <div key={p.id} className="flex items-center gap-4 px-5 py-4">
                {/* Avatar */}
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-emerald-700 font-bold text-sm">{p.nome.charAt(0)}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{p.nome}</p>
                  <p className="text-xs text-gray-500">{p.especialidade} · {p.duracaoConsultaMin} min</p>
                  {p.calendarId && (
                    <p className="text-xs text-emerald-600 mt-0.5">Google Calendar vinculado</p>
                  )}
                </div>

                {/* Status */}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {p.ativo ? 'Ativo' : 'Inativo'}
                </span>

                {/* Ações */}
                <div className="flex items-center gap-2">
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
