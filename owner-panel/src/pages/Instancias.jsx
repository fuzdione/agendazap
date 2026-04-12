import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode, Plus, Check, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { Smartphone } from 'lucide-react';

// ── Modal QR Code ─────────────────────────────────────────────────
function ModalQRCode({ clinica, onClose, onConectado }) {
  const [qrData, setQrData] = useState(null);
  const [loadingQR, setLoadingQR] = useState(true);
  const [conectado, setConectado] = useState(false);

  async function buscarQR() {
    setLoadingQR(true);
    try {
      const { data } = await api.get(`/owner/instancias/${clinica.clinicaId}/qrcode`);
      setQrData(data.data);
    } catch {
      setQrData(null);
    } finally {
      setLoadingQR(false);
    }
  }

  // Polling de status a cada 5s — fecha modal quando conectar
  useEffect(() => {
    buscarQR();
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get('/owner/instancias');
        const item = data.data.find((c) => c.clinicaId === clinica.clinicaId);
        if (item?.status === 'conectado') {
          setConectado(true);
          clearInterval(interval);
          setTimeout(() => { onConectado(); onClose(); }, 1500);
        }
      } catch {
        // silencia
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [clinica.clinicaId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        {conectado ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check size={32} className="text-emerald-600" />
            </div>
            <p className="text-lg font-semibold text-slate-900">WhatsApp Conectado!</p>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">{clinica.nome}</h3>
            <p className="text-sm text-slate-500 mb-4">
              Abra o WhatsApp → Dispositivos Conectados → Conectar dispositivo
            </p>

            {loadingQR ? (
              <LoadingSpinner className="py-16" />
            ) : qrData?.base64 ? (
              <img
                src={qrData.base64}
                alt="QR Code"
                className="w-64 h-64 mx-auto rounded-lg border border-slate-200"
              />
            ) : (
              <p className="text-sm text-slate-500 text-center py-8">QR Code não disponível.</p>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={buscarQR}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <RefreshCw size={14} />
                Atualizar QR
              </button>
              <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors">
                Fechar
              </button>
            </div>

            <p className="text-xs text-slate-400 text-center mt-3">Verificando status automaticamente...</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────
export default function Instancias() {
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const clinicaIdFoco = searchParams.get('clinicaId');

  const [instancias, setInstancias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalQR, setModalQR] = useState(null); // instância selecionada
  const [criando, setCriando] = useState(null); // clinicaId

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/owner/instancias');
      setInstancias(data.data);
    } catch {
      addToast('Erro ao carregar instâncias.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Se veio da dashboard com clinicaId, abre o modal automaticamente após carregamento
  useEffect(() => {
    if (clinicaIdFoco && instancias.length > 0) {
      const item = instancias.find((i) => i.clinicaId === clinicaIdFoco);
      if (item && item.status !== 'conectado') setModalQR(item);
    }
  }, [clinicaIdFoco, instancias]);

  async function handleCriarInstancia(clinicaId) {
    setCriando(clinicaId);
    try {
      await api.post(`/owner/instancias/${clinicaId}/criar`);
      addToast('Instância criada! Agora conecte o WhatsApp escaneando o QR code.', 'success');
      await carregar();
      const item = instancias.find((i) => i.clinicaId === clinicaId) ?? { clinicaId };
      setModalQR(item);
    } catch (err) {
      addToast(err.response?.data?.error ?? 'Erro ao criar instância.', 'error');
    } finally {
      setCriando(null);
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Instâncias WhatsApp</h1>
          <p className="text-slate-500 text-sm mt-1">Status de conexão de todas as clínicas</p>
        </div>
        <button
          onClick={carregar}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
        >
          <RefreshCw size={14} />
          Atualizar
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : instancias.length === 0 ? (
          <EmptyState icon={Smartphone} title="Nenhuma clínica encontrada" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Clínica', 'Telefone', 'Status', 'Ações'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {instancias.map((inst) => (
                  <tr key={inst.clinicaId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{inst.nome}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{inst.telefone}</td>
                    <td className="px-4 py-3"><StatusBadge status={inst.status} /></td>
                    <td className="px-4 py-3">
                      {inst.status === 'sem_instancia' && (
                        <button
                          onClick={() => handleCriarInstancia(inst.clinicaId)}
                          disabled={criando === inst.clinicaId}
                          className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Plus size={13} />
                          {criando === inst.clinicaId ? 'Criando...' : 'Criar Instância'}
                        </button>
                      )}
                      {inst.status === 'desconectado' && (
                        <button
                          onClick={() => setModalQR(inst)}
                          className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <QrCode size={13} />
                          Ver QR Code
                        </button>
                      )}
                      {inst.status === 'conectado' && (
                        <span className="text-xs text-emerald-600 font-medium">Conectado</span>
                      )}
                      {inst.status === 'inativa' && (
                        <span className="text-xs text-slate-400">Clínica inativa</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalQR && (
        <ModalQRCode
          clinica={modalQR}
          onClose={() => setModalQR(null)}
          onConectado={carregar}
        />
      )}
    </div>
  );
}
