import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, KeyRound, Copy, Check } from 'lucide-react';
import { api } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Building2 } from 'lucide-react';

// ── Modal Nova Clínica ──────────────────────────────────────────────
function ModalNovaClinica({ onClose, onCriada }) {
  const { addToast } = useToast();
  const [form, setForm] = useState({ nome: '', telefoneWpp: '', endereco: '', adminEmail: '', adminSenha: '' });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    if (form.adminSenha.length < 6) {
      setErro('A senha do admin deve ter pelo menos 6 caracteres.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/owner/clinicas', form);
      addToast('Clínica criada com sucesso!', 'success');
      onCriada();
    } catch (err) {
      setErro(err.response?.data?.error ?? 'Erro ao criar clínica.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Nova Clínica</h3>

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {erro}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nome da Clínica *" value={form.nome} onChange={(v) => set('nome', v)} placeholder="Ex: Clínica São Paulo" required />
          <Field label="Telefone WhatsApp *" value={form.telefoneWpp} onChange={(v) => set('telefoneWpp', v)} placeholder="5511999990000" required />
          <Field label="Endereço (opcional)" value={form.endereco} onChange={(v) => set('endereco', v)} placeholder="Rua..." />
          <Field label="E-mail do Admin *" type="email" value={form.adminEmail} onChange={(v) => set('adminEmail', v)} placeholder="admin@clinica.com.br" required />
          <Field label="Senha do Admin *" type="password" value={form.adminSenha} onChange={(v) => set('adminSenha', v)} placeholder="mínimo 6 caracteres" required />

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors">
              {loading ? 'Criando...' : 'Criar Clínica'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
    </div>
  );
}

// ── Modal Reset Senha ───────────────────────────────────────────────
function ModalResetSenha({ clinica, onClose }) {
  const [confirmando, setConfirmando] = useState(true);
  const [loading, setLoading] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setLoading(true);
    setErro('');
    try {
      const { data } = await api.post(`/owner/clinicas/${clinica.id}/reset-senha`);
      setNovaSenha(data.data.novaSenha);
      setConfirmando(false);
    } catch (err) {
      setErro(err.response?.data?.error ?? 'Erro ao resetar senha.');
    } finally {
      setLoading(false);
    }
  }

  function copiar() {
    navigator.clipboard.writeText(novaSenha);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        {confirmando ? (
          <>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Resetar senha do admin</h3>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja resetar a senha do admin de <strong>{clinica.nome}</strong>? Uma nova senha será gerada e a atual deixará de funcionar.
            </p>
            {erro && <p className="text-sm text-red-600 mb-4">{erro}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg transition-colors">
                {loading ? 'Resetando...' : 'Resetar senha'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Nova senha gerada</h3>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
              Anote esta senha — ela não será exibida novamente.
            </p>
            <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-4 py-3 mb-4">
              <code className="flex-1 text-slate-900 font-mono text-sm tracking-wider">{novaSenha}</code>
              <button onClick={copiar} className="shrink-0 text-slate-500 hover:text-slate-700">
                {copiado ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors">
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Página principal ────────────────────────────────────────────────
export default function Clinicas() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [clinicas, setClinicas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [modalNova, setModalNova] = useState(false);
  const [modalReset, setModalReset] = useState(null); // clínica selecionada
  const [confirmToggle, setConfirmToggle] = useState(null); // clínica selecionada

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (busca) params.set('busca', busca);
      if (filtroAtivo !== '') params.set('ativo', filtroAtivo);

      const { data } = await api.get(`/owner/clinicas?${params}`);
      setClinicas(data.data.clinicas);
      setTotalPages(data.data.paginacao.totalPages);
    } catch {
      addToast('Erro ao carregar clínicas.', 'error');
    } finally {
      setLoading(false);
    }
  }, [busca, filtroAtivo, page, addToast]);

  useEffect(() => { carregar(); }, [carregar]);

  async function handleToggle() {
    const c = confirmToggle;
    setConfirmToggle(null);
    try {
      await api.put(`/owner/clinicas/${c.id}/toggle`);
      addToast(`Clínica ${c.ativo ? 'desativada' : 'ativada'} com sucesso.`, 'success');
      carregar();
    } catch {
      addToast('Erro ao alterar status da clínica.', 'error');
    }
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clínicas</h1>
          <p className="text-slate-500 text-sm mt-1">Gerencie todas as clínicas clientes</p>
        </div>
        <button
          onClick={() => setModalNova(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          Nova Clínica
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(1); }}
            placeholder="Buscar por nome ou telefone..."
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <select
          value={filtroAtivo}
          onChange={(e) => { setFiltroAtivo(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
        >
          <option value="">Todas</option>
          <option value="true">Ativas</option>
          <option value="false">Inativas</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : clinicas.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhuma clínica encontrada" description="Tente ajustar os filtros ou crie uma nova clínica." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Nome', 'Telefone', 'Agendamentos', 'Pacientes', 'WhatsApp', 'Status', 'Ações'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clinicas.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{c.nome}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.telefoneWpp}</td>
                    <td className="px-4 py-3 text-slate-600">{c.totalAgendamentos}</td>
                    <td className="px-4 py-3 text-slate-600">{c.totalPacientes}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.statusWhatsapp} /></td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConfirmToggle(c)}
                        className={[
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          c.ativo ? 'bg-emerald-500' : 'bg-slate-300',
                        ].join(' ')}
                        title={c.ativo ? 'Desativar clínica' : 'Ativar clínica'}
                      >
                        <span className={[
                          'inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform',
                          c.ativo ? 'translate-x-4' : 'translate-x-1',
                        ].join(' ')} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/clinicas/${c.id}`)}
                          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Eye size={13} />
                          Detalhes
                        </button>
                        <button
                          onClick={() => setModalReset(c)}
                          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <KeyRound size={13} />
                          Reset Senha
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600">Página {page} de {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            Próxima
          </button>
        </div>
      )}

      {/* Modais */}
      {modalNova && (
        <ModalNovaClinica
          onClose={() => setModalNova(false)}
          onCriada={() => { setModalNova(false); carregar(); }}
        />
      )}

      {modalReset && (
        <ModalResetSenha
          clinica={modalReset}
          onClose={() => setModalReset(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmToggle}
        title={confirmToggle?.ativo ? 'Desativar clínica' : 'Ativar clínica'}
        message={
          confirmToggle?.ativo
            ? `Desativar "${confirmToggle?.nome}" impedirá que o bot processe novas mensagens. Os dados não serão apagados.`
            : `Ativar "${confirmToggle?.nome}" permitirá que o bot processe mensagens novamente.`
        }
        confirmLabel={confirmToggle?.ativo ? 'Desativar' : 'Ativar'}
        danger={confirmToggle?.ativo}
        onConfirm={handleToggle}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  );
}
