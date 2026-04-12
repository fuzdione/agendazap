/**
 * Modal de confirmação para ações destrutivas ou irreversíveis.
 * Props:
 *   open: boolean
 *   title: string
 *   message: string
 *   confirmLabel?: string (padrão: "Confirmar")
 *   danger?: boolean — botão vermelho se true
 *   onConfirm: () => void
 *   onCancel: () => void
 */
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', danger = false, onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={[
              'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-slate-700 hover:bg-slate-800',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
