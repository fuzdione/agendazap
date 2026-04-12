/**
 * Badge de status para instâncias WhatsApp e clínicas.
 * status: "conectado" | "desconectado" | "sem_instancia" | "inativa"
 */
export default function StatusBadge({ status }) {
  const map = {
    conectado:     { label: 'Conectado',     cls: 'bg-emerald-100 text-emerald-800' },
    desconectado:  { label: 'Desconectado',  cls: 'bg-red-100 text-red-800' },
    sem_instancia: { label: 'Sem instância', cls: 'bg-slate-100 text-slate-600' },
    inativa:       { label: 'Clínica inativa', cls: 'bg-slate-100 text-slate-500' },
  };

  const { label, cls } = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
