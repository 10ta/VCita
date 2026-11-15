/** VCita 的标志：V 画成卡面上考点高亮的样子（深橙底 + 亮橙 V），和 public/favicon.svg 同一个图形 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#3a1606" />
      <path d="M8 9 16 24 24 9" fill="none" stroke="#ff6a2b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
