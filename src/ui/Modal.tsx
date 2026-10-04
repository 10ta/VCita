import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './Icon';

/** 基于原生 <dialog>：自带焦点管理和 Esc 关闭 */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const upOnBackdrop = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // 只有"按下和松开都在背景上"才算点背景关闭（反过来，在背景按下、拖进弹窗里松开，也不关闭）。
      // 在输入框里按住拖选文字、拖到弹窗外松开时，浏览器会把这次 click 记在弹窗本身上，不能当成点背景。
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === ref.current;
        upOnBackdrop.current = false;
      }}
      onPointerUp={(e) => {
        upOnBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        const ok = downOnBackdrop.current && upOnBackdrop.current && e.target === ref.current;
        downOnBackdrop.current = false;
        upOnBackdrop.current = false;
        if (ok) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="close" label="关闭" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}