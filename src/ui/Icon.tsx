const PATHS = {
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  play: 'M8 5.5v13l10.5-6.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  up: 'M12 7l6 7H6z',
  left: 'M7 12l7-6v12z',
  right: 'M17 12l-7 6V6z',
  down: 'M12 17l-6-7h12z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: 'danger';
}) {
  return (
    <button type="button" className={`icon-btn${tone ? ` is-${tone}` : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}
