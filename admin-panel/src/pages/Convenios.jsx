import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { Plus, Pencil, Trash2, X, CheckCircle, XCircle } from 'lucide-react';

export default function Convenios() {
  const [convenios, setConvenios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    try {
      setLoading(true);
      const { data } = await api.get('/admin/convenios');
      setConvenios(data.data);
    } catch {
      setErro('Erro ao carregar convênios');
    } finally {
      setLoading(false);
    }
  }

  function abrirModal(convenio = null) {
    if (convenio) {
      setEditandoId(convenio.id);
      setNome(convenio.nome);
    } else {
      setEditandoId(null);
      setNome('');
    }
    setErro('');
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setNome('');
    setEditandoId(null);
    setErro('');
  }

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      if (editandoId) {
        await api.put(`/admin/convenios/${editandoId}`, { nome });
      } else {
        await api.post('/admin/convenios', { nome });
      }
      await carregar();
      fecharModal();
    } catch (err) {
      setErro(err.response?.data?.error ?? 'Erro ao salvar convênio');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(convenio) {
    try {
      await api.put(`/admin/convenios/${convenio.id}`, { ativo: !convenio.ativo });
      await carregar();
    } catch {
      setErro('Erro ao atualizar convênio');
    }
  }

  async function remover(convenio) {
    if (!window.confirm(`Remover o convênio "${convenio.nome}"?`)) return;
    try {
      await api.delete(`/admin/convenios/${convenio.id}`);
      await carregar();
    } catch {
      setErro('Erro ao remover convênio');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Convênios</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gerencie os planos de saúde aceitos pela clínica
          </p>
        </div>
        <button
          onClick={() => abrirModal()}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <Plus size={16} />
          Novo convênio
        </button>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {erro}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Carregando...</div>
      ) : convenios.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">Nenhum convênio cadastrado.</p>
          <p className="text-gray-400 text-xs mt-1">
            Quando não há convênios, o bot agenda apenas como particular.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Profissionais</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {convenios.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => alternarAtivo(c)}
                      title={c.ativo ? 'Clique para desativar' : 'Clique para ativar'}
                      className="flex items-center gap-1.5 text-xs font-medium"
                    >
                      {c.ativo ? (
                        <><CheckCircle size={14} className="text-emerald-500" /><span className="text-emerald-600">Ativo</span></>
                      ) : (
                        <><XCircle size={14} className="text-gray-400" /><span className="text-gray-400">Inativo</span></>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.profissionais?.length > 0
                      ? c.profissionais.map((pc) => pc.profissional.nome).join(', ')
                      : <span className="text-gray-300 italic">nenhum vinculado</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => abrirModal(c)}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
                        title="Editar nome"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => remover(c)}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                        title="Remover"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editandoId ? 'Editar convênio' : 'Novo convênio'}
              </h2>
              <button onClick={fecharModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {erro && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm mb-4">
                {erro}
              </div>
            )}

            <form onSubmit={salvar} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do convênio
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Amil, Unimed, Bradesco Saúde"
                  required
                  maxLength={100}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={fecharModal}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando || !nome.trim()}
                  className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
