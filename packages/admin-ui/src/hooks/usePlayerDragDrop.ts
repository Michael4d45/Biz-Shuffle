import { useCallback, useState, type DragEvent } from "react";

export function usePlayerDragDrop() {
  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const onDragStart = useCallback((player: string) => {
    setDraggedPlayer(player);
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggedPlayer(null);
    setDropTarget(null);
  }, []);

  const onDragOver = useCallback((targetId: string, e: DragEvent) => {
    e.preventDefault();
    setDropTarget(targetId);
  }, []);

  const onDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  return {
    draggedPlayer,
    dropTarget,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
  };
}
