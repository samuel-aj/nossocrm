import { useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';

export function imageFilesFromTransfer(transfer: DataTransfer): File[] {
  const files = Array.from(transfer.files || []);
  const candidates = files.length ? files : Array.from(transfer.items || [])
    .filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
  return candidates.filter(file => file.type.startsWith('image/'));
}

export function useChatImageTransfer({ onFile, blocked, onError }: {
  onFile: (file: File) => void;
  blocked: boolean;
  onError: (message: string) => void;
}) {
  const [draggingImage, setDraggingImage] = useState(false);
  const depth = useRef(0);
  const accept = (files: File[]) => {
    if (blocked) { onError('Aguarde ou habilite o envio de mensagens antes de anexar uma imagem.'); return; }
    if (files.length !== 1) { onError('Cole ou arraste uma imagem por vez.'); return; }
    onFile(files[0]);
  };
  return {
    draggingImage,
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = imageFilesFromTransfer(event.clipboardData);
      if (!files.length) return; // Plain text keeps the browser's normal paste behavior.
      event.preventDefault();
      accept(files);
    },
    dropHandlers: {
      onDragEnter: (event: DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        depth.current++;
        if (!blocked) setDraggingImage(true);
      },
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDraggingImage(false);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        depth.current = 0;
        setDraggingImage(false);
        if (!Array.from(event.dataTransfer.types).includes('Files') && !event.dataTransfer.files.length) return;
        event.preventDefault(); // Never let the browser navigate to the dropped file.
        const files = imageFilesFromTransfer(event.dataTransfer);
        if (!files.length) { onError('Arraste um arquivo de imagem para anexar ao chat.'); return; }
        if (event.dataTransfer.files.length > 1) { onError('Arraste uma imagem por vez.'); return; }
        accept(files);
      },
    },
  };
}
