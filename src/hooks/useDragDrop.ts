import { useEffect, useRef, useState } from "react";

interface UseDragDropOptions {
  onFiles: (files: File[]) => void;
  containerRef?: React.RefObject<HTMLElement>;
}

export function useDragDrop({ onFiles, containerRef }: UseDragDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => {
    const target = containerRef?.current ?? document;

    function hasFileItems(dt: DataTransfer): boolean {
      return Array.from(dt.items).some((i) => i.kind === "file");
    }

    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      if (!e.dataTransfer || !hasFileItems(e.dataTransfer)) return;
      counterRef.current += 1;
      setIsDragging(true);
    }

    function handleDragOver(e: DragEvent) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }

    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      counterRef.current -= 1;
      if (counterRef.current <= 0) {
        counterRef.current = 0;
        setIsDragging(false);
      }
    }

    function handleDrop(e: DragEvent) {
      e.preventDefault();
      counterRef.current = 0;
      setIsDragging(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    }

    target.addEventListener("dragenter",  handleDragEnter  as EventListener);
    target.addEventListener("dragover",   handleDragOver   as EventListener);
    target.addEventListener("dragleave",  handleDragLeave  as EventListener);
    target.addEventListener("drop",       handleDrop       as EventListener);

    return () => {
      target.removeEventListener("dragenter",  handleDragEnter  as EventListener);
      target.removeEventListener("dragover",   handleDragOver   as EventListener);
      target.removeEventListener("dragleave",  handleDragLeave  as EventListener);
      target.removeEventListener("drop",       handleDrop       as EventListener);
    };
  }, [onFiles, containerRef]);

  return { isDragging };
}
