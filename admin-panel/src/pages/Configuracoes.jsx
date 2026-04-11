import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CheckCircle, XCircle, RefreshCw, QrCode, ExternalLink } from 'lucide-react';

function StatusBadge({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
    }`}>
      {ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {label}
    </span>
  );
}

export default function Configuracoes() {
  const { clinica: clinicaAuth } = useAuth();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  // Status WhatsApp
  const [wppStatus, setWppStatus] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [carregandoWpp, setCarregandoWpp] = useState(false);

  // Status Google Calendar
  const [googleStatus, setGoogleStatus] = useState(null);
  const [carregandoGoogle, setCarregandoGoogle] = useState(false);

  useEffect(() => {
    carregarConfig();
    carregarStatusWpp();
    carregarStatusGoogle();
  }, []);

  async function carregarConfig() {
    try {
      const { data } = await api.get('/admin/configuracoes');
      setConfig(data.data);
    } catch {
      setErro('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  }

  async function carregarStatusWpp() {
    if (!clinicaAuth?.id) return;
    setCarregandoWpp(true);
    try {
      const { data } = await api.get(`/admin/instance/${clinicaAuth.id}/status`);
      setWppStatus(data);
    } catch {
      setWppStatus(null);
    } finally {
      setCarregandoWpp(false);
    }
  }

  async function carregarQrCode() {
    if (!clinicaAuth?.id) return;
    try {
      const { data } = await api.get(`/admin/instance/${clinicaAuth.id}/qrcode`);
      setQrCode(data.data?.qrcode ?? null);
    } catch {
      alert('Erro ao obter QR Code');
    }
  }

  async function carregarStatusGoogle() {
    if (!clinicaAuth?.id) return;
    setCarregandoGoogle(true);
    try {
      const { data } = await api.get(`/admin/google/status/${clinicaAuth.id}`);
      setGoogleStatus(data);
    } catch {
      setGoogleStatus(null);
    } finally {
      setCarregandoGoogle(false);
    }
  }

  function atualizarConfig(campo, valor) {
    setConfig((prev) => ({ ...prev, [campo]: valor }));
  }

  function atualizarConfigJson(campo, valor) {
    setConfig((prev) => ({
      ...prev,
      configJson: { ...(prev.configJson ?? {}), [campo]: valor },
    }));
  }

  function atualizarHorario(periodo, limite, valor) {
    setConfig((prev) => ({
      ...prev,
      configJson: {
        ...(prev.configJson ?? {}),
        horario_funcionamento: {
          ...(prev.configJson?.horario_funcionamento ?? {}),
          [periodo]: {
            ...(prev.configJson?.horario_funcionamento?.[periodo] ?? {}),
            [limite]: valor,
          },
        },
      },
    }));
  }

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    setMensagem('');
    setErro('');
    try {
      await api.put('/admin/configuracoes', {
        nome: config.nome,
        endereco: config.endereco,
        configJson: config.configJson,
      });
      setMensagem('Configurações salvas com sucesso!');
      setTimeout(() => setMensagem(''), 4000);
    } catch {
      setErro('Erro ao salvar configurações');
    } finally {
      setSalvando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const hf = config?.configJson?.horario_funcionamento ?? {};

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>

      {mensagem && (
        <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          {mensagem}
        </div>
      )}
      {erro && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {erro}
        </div>
      )}

      <form onSubmit={salvar} className="space-y-6">
        {/* Dados da clínica */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Dados da clínica</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome da clínica</label>
              <input
                value={config?.nome ?? ''}
                onChange={(e) => atualizarConfig('nome', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
              <input
                value={config?.endereco ?? ''}
                onChange={(e) => atualizarConfig('endereco', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Horários de funcionamento */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Horários de funcionamento</h2>
          <div className="space-y-4">
            {[
              { key: 'seg_sex', label: 'Segunda a Sexta' },
              { key: 'sab',     label: 'Sábado' },
            ].map(({ key, label }) => (
              <div key={key}>
                <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
                <div className="flex items-center gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Abertura</label>
                    <input
                      type="time"
                      value={hf[key]?.inicio ?? '08:00'}
                      onChange={(e) => atualizarHorario(key, 'inicio', e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <span className="text-gray-400 mt-5">até</span>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fechamento</label>
                    <input
                      type="time"
                      value={hf[key]?.fim ?? '18:00'}
                      onChange={(e) => atualizarHorario(key, 'fim', e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mensagens e configurações do bot */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Bot e atendimento</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mensagem de boas-vindas
              </label>
              <textarea
                rows={3}
                value={config?.configJson?.mensagem_boas_vindas ?? ''}
                onChange={(e) => atualizarConfigJson('mensagem_boas_vindas', e.target.value)}
                placeholder="Ex: Olá! Bem-vindo à Clínica Saúde Plena. Como posso ajudar?"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Telefone de fallback (recepção)
              </label>
              <input
                type="tel"
                value={config?.configJson?.telefone_fallback ?? ''}
                onChange={(e) => atualizarConfigJson('telefone_fallback', e.target.value)}
                placeholder="5561999990000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Número enviado ao paciente quando o bot não consegue ajudar.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={salvando}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {salvando ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      </form>

      {/* Status WhatsApp */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Conexão WhatsApp</h2>
          <button
            onClick={carregarStatusWpp}
            disabled={carregandoWpp}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw size={12} className={carregandoWpp ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge
            ok={wppStatus?.data?.instance?.state === 'open'}
            label={wppStatus?.data?.instance?.state === 'open' ? 'Conectado' : 'Desconectado'}
          />
          {wppStatus?.data?.instance?.state !== 'open' && (
            <button
              onClick={carregarQrCode}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
            >
              <QrCode size={14} />
              Ver QR Code
            </button>
          )}
        </div>
        {qrCode && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg inline-block">
            <img src={`data:image/png;base64,${qrCode}`} alt="QR Code WhatsApp" className="w-48 h-48" />
            <p className="text-xs text-gray-400 text-center mt-2">Escaneie com o WhatsApp</p>
          </div>
        )}
      </div>

      {/* Status Google Calendar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Conexão Google Calendar</h2>
          <button
            onClick={carregarStatusGoogle}
            disabled={carregandoGoogle}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw size={12} className={carregandoGoogle ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge
            ok={googleStatus?.data?.conectado}
            label={googleStatus?.data?.conectado ? 'Autorizado' : 'Não autorizado'}
          />
          {!googleStatus?.data?.conectado && (
            <a
              href={`/api/admin/google/auth/${clinicaAuth?.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
            >
              <ExternalLink size={14} />
              Autorizar acesso
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
