export function FilePicker({ label, accept, disabled, onFile }: { label: string; accept: string; disabled?: boolean; onFile: (file: File) => void }) {
  return <label className={`oui-button oui-button--secondary oui-file-picker ${disabled ? 'oui-file-picker--disabled' : ''}`}>
    <span>{label}</span><input type="file" aria-label={label} accept={accept} disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onFile(file);
    }} />
  </label>;
}
