import { useState, type DragEvent } from 'react';

export function useFileDrop(disabled: boolean, onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const hasFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files');
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    if (!disabled) setDragging(true);
  };
  return {
    dragging: dragging && !disabled,
    dropProps: {
      onDragEnter: onDragOver,
      onDragOver,
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!hasFiles(event) && !event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}
