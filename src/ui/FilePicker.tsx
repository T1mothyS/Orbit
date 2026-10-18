export function FilePicker({ id, label, accept, disabled, onFile }: { id?: string; label: string; accept: string; disabled?: boolean; onFile: (file: File) => void }) {
  return <label className={`oui-button oui-button--secondary oui-file-picker ${disabled ? 'oui-file-picker--disabled' : ''}`}>
    <span>{label}</span><input id={id} type="file" aria-label={label} accept={accept} disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onFile(file);
    }} />
  </label>;
}
