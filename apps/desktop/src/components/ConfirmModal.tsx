type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Modal de confirmación con el mismo patrón visual del resto de la app. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="modal-back" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="page-title"
          style={{ fontSize: "1.35rem", marginBottom: "0.5rem" }}
        >
          {title}
        </h2>
        <p className="page-sub" style={{ marginBottom: "1.1rem" }}>
          {message}
        </p>
        <div className="form-inline" style={{ justifyContent: "flex-end" }}>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={danger ? "btn danger" : "btn accent"}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Espera…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
