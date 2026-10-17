export function Avatar({ label, src, size = 32 }: { label: string; src?: string; size?: 32 | 48 }) {
  return <span className={`oui-avatar ${size === 48 ? 'oui-avatar--large' : ''}`} aria-hidden="true">{src ? <img src={src} alt="" /> : label.slice(0, 1).toLocaleUpperCase() || 'O'}</span>;
}
