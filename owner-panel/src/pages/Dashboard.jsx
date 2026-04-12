import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, BuildingIcon, Calendar, CalendarDays, AlertTriangle } from 'lucide-react';
import { api } from '../services/api.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

function StatCard({ label, value, icon: Icon, color = 'slate' }) {
  const colors = {
    slate:   { bg: 'bg-slate-100',   text: 'text-slate-700',   icon: 'text-slate-500' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'text-emerald-500' },
    zinc:    { bg: 'bg-zinc-100',    text: 'text-zinc-600',    icon: 'text-zinc-500' },
    sky:     { bg: 'bg-sky-100',     text: 'text-sky-700',     icon: 'text-sky-500' },
  };
  const c = colors[color] ?? colors.slate;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
        <Icon size={22} className={c.icon} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value ?? '—'}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function InfraIndicator({ label, ok }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-3 h-3 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span className="text-sm text-slate-700">{label}</span>
      <span className={`text-xs font-medium ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
        {ok ? 'OK' : 'Falha'}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get('/owner/dashboard')
      .then(({ data }) => setDados(data.data))
      .catch(() => setErro('Não foi possível carregar o dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner className="mt-20" />;
  if (erro) return <p className="text-red-600 text-sm mt-8 text-center">{erro}</p>;

  const { clinicasAtivas, clinicasInativas, agendamentosHoje, agendamentosSemana, infraestrutura, alertas } = dados;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Visão geral de todas as clínicas</p>
      </div>

      {/* Cards de métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Clínicas ativas"    value={clinicasAtivas}    icon={Building2}      color="emerald" />
        <StatCard label="Clínicas inativas"  value={clinicasInativas}  icon={BuildingIcon}   color="zinc" />
        <StatCard label="Agendamentos hoje"  value={agendamentosHoje}  icon={Calendar}       color="sky" />
        <StatCard label="Agendamentos semana" value={agendamentosSemana} icon={CalendarDays} color="slate" />
      </div>

      {/* Status da infraestrutura */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Infraestrutura</h2>
        <div className="space-y-3">
          <InfraIndicator label="Banco de dados (PostgreSQL)" ok={infraestrutura.db} />
          <InfraIndicator label="Cache (Redis)"               ok={infraestrutura.redis} />
          <InfraIndicator label="Evolution API (WhatsApp)"    ok={infraestrutura.evolutionApi} />
        </div>
      </div>

      {/* Alertas de WhatsApp desconectado */}
      {alertas.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-amber-500" />
            <h2 className="text-base font-semibold text-slate-900">
              Alertas — WhatsApp desconectado ({alertas.length})
            </h2>
          </div>
          <div className="space-y-2">
            {alertas.map((alerta) => (
              <div key={alerta.clinicaId} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="text-sm text-slate-700">{alerta.clinica}</span>
                <button
                  onClick={() => navigate(`/instancias?clinicaId=${alerta.clinicaId}`)}
                  className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Reconectar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {alertas.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-700 font-medium">
          Todas as clínicas ativas estão com WhatsApp conectado.
        </div>
      )}
    </div>
  );
}
