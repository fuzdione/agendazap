import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Copy, Check, QrCode } from 'lucide-react';
import { api } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

// ── Modal QR Code ─────────────────────────────────────────────────
function ModalQRCode({ clinicaId, onClose }) {
  const [qrData, setQrData] = useState(null);
  const [status, setStatus] = useState('carregando');
  const [loading, setLoading] = useState(true);

  async function buscarQR() {
    setLoading(true);
    try {
      const { data } = await api.get(`/owner/instancias/${clinicaId}/qrcode`);
      setQrData(data.data);
    } catch {
      setQrData(null);
    } finally {
      setLoading(false);
    }
  }

  // Polling de status a cada 5 segundos
  useEffect(() => {
    buscarQR();
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/owner/instancias`);
        const clinica = data.data.find((c) => c.clinicaId === clinicaId);
        if (clinica?.status === 'conectado') {
          setStatus('conectado');
          clearInterval(interval);
        }
      } catch {
        // silencia
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [clinicaId]);

  if (status === 'conectado') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-slate-900 mb-2">WhatsApp Conectado!</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Conectar WhatsApp</h3>
        <p className="text-sm text-slate-500 mb-4">Abra o WhatsApp → Dispositivos Conectados → Conectar dispositivo</p>

        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : qrData ? (
          <div className="flex flex-col items-center gap-4">
            {qrData.base64 && (
              <img src={qrData.base64} alt="QR Code" className="w-64 h-64 rounded-lg border border-slate-200" />
            )}
            {!qrData.base64 && (
              <p className="text-sm text-slate-500 text-center py-8">QR Code não disponível. Tente atualizar.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-red-600 text-center py-8">Não foi possível carregar o QR code.</p>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={buscarQR} className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            Atualizar QR
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors">
            Fechar
          </button>
        </div>

        <p className="text-xs text-slate-400 text-center mt-3">Aguardando conexão...</p>
      </div>
    </div>
  );
}

// ── Modal Reset Senha ─────────────────────────────────────────────
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
              Isso irá gerar uma nova senha para o admin de <strong>{clinica.nome}</strong>. A senha atual deixará de funcionar imediatamente.
            </p>
            {erro && <p className="text-sm text-red-600 mb-4">{erro}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Cancelar</button>
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
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors">Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────
export default function ClinicaDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [clinica, setClinica] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalQR, setModalQR] = useState(false);
  const [modalReset, setModalReset] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get(`/owner/clinicas/${id}`)
      .then(({ data }) => setClinica(data.data))
      .catch(() => addToast('Erro ao carregar dados da clínica.', 'error'))
      .finally(() => setLoading(false));
  }, [id, addToast]);

  async function handleToggle() {
    setConfirmToggle(false);
    setToggling(true);
    try {
      const { data } = await api.put(`/owner/clinicas/${id}/toggle`);
      setClinica((prev) => ({ ...prev, ativo: data.data.ativo }));
      addToast(`Clínica ${data.data.ativo ? 'ativada' : 'desativada'} com sucesso.`, 'success');
    } catch {
      addToast('Erro ao alterar status da clínica.', 'error');
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <LoadingSpinner className="mt-20" />;
  if (!clinica) return <p className="text-slate-600 text-center mt-20">Clínica não encontrada.</p>;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Cabeçalho */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/clinicas')} className="text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{clinica.nome}</h1>
          <p className="text-slate-500 text-sm">Detalhes da clínica</p>
        </div>
      </div>

      {/* Dados básicos */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Info label="Telefone WhatsApp" value={<code className="font-mono text-sm">{clinica.telefoneWpp}</code>} />
        <Info label="Endereço" value={clinica.endereco ?? '—'} />
        <Info label="Cadastro" value={new Date(clinica.createdAt).toLocaleDateString('pt-BR')} />
        <Info label="Status" value={<span className={`text-sm font-medium ${clinica.ativo ? 'text-emerald-600' : 'text-slate-500'}`}>{clinica.ativo ? 'Ativa' : 'Inativa'}</span>} />
        <Info label="Total de Pacientes" value={clinica.totalPacientes} />
        <Info label="Agendamentos no Mês" value={clinica.agendamentosMes} />
      </div>

      {/* Integrações */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Integrações</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">WhatsApp</p>
            <StatusBadge status={clinica.statusWhatsapp} />
          </div>
          {clinica.statusWhatsapp !== 'conectado' && (
            <button
              onClick={() => setModalQR(true)}
              className="flex items-center gap-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors"
            >
              <QrCode size={16} />
              Ver QR Code
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-slate-700">Google Calendar</p>
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${clinica.googleCalendarConectado ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
            {clinica.googleCalendarConectado ? 'Conectado' : 'Não conectado'}
          </span>
        </div>
      </div>

      {/* Profissionais */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Profissionais ({clinica.profissionais.length})</h2>
        {clinica.profissionais.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum profissional cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {clinica.profissionais.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-800">{p.nome}</p>
                  <p className="text-xs text-slate-500">{p.especialidade} · {p.duracaoConsultaMin} min</p>
                </div>
                {p.calendarId && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Calendar vinculado</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setModalReset(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <KeyRound size={16} />
          Resetar Senha do Admin
        </button>
        <button
          onClick={() => setConfirmToggle(true)}
          disabled={toggling}
          className={[
            'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60',
            clinica.ativo
              ? 'text-red-700 bg-red-50 hover:bg-red-100'
              : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100',
          ].join(' ')}
        >
          {clinica.ativo ? 'Desativar Clínica' : 'Ativar Clínica'}
        </button>
      </div>

      {/* Modais */}
      {modalQR && <ModalQRCode clinicaId={id} onClose={() => setModalQR(false)} />}
      {modalReset && <ModalResetSenha clinica={clinica} onClose={() => setModalReset(false)} />}

      <ConfirmDialog
        open={confirmToggle}
        title={clinica.ativo ? 'Desativar clínica' : 'Ativar clínica'}
        message={
          clinica.ativo
            ? `Desativar "${clinica.nome}" impedirá que o bot processe novas mensagens. Os dados não serão apagados.`
            : `Ativar "${clinica.nome}" permitirá que o bot processe mensagens novamente.`
        }
        confirmLabel={clinica.ativo ? 'Desativar' : 'Ativar'}
        danger={clinica.ativo}
        onConfirm={handleToggle}
        onCancel={() => setConfirmToggle(false)}
      />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-0.5">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  );
}
