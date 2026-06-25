import { useEffect, useRef } from 'react';
import { useStore, captureSnapshot } from '../store/useStore';
import type { HistorySnapshot } from '../store/useStore';

/**
 * Subscribes to the Zustand store and automatically pushes history whenever
 * any meaningful settings state changes. Uses a 300ms debounce so rapid
 * continuous changes (slider drags, color pickers) collapse into one entry.
 *
 * Captures the state BEFORE the change begins by saving prevState on the
 * first settings-change event and holding it through the debounce window.
 *
 * Skips when historyStack itself changes (meaning an explicit push or undo
 * just happened), preventing double-entries.
 */
export function useHistorySync() {
  const pendingSnapshot = useRef<HistorySnapshot | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prevState) => {
      // historyStack reference changed → a push or undo just happened; reset.
      if (state.historyStack !== prevState.historyStack) {
        pendingSnapshot.current = null;
        clearTimeout(debounceTimer.current);
        return;
      }

      // Capture the "before" state only once per interaction sequence.
      if (pendingSnapshot.current === null) {
        pendingSnapshot.current = captureSnapshot(prevState);
      }

      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const snapshot = pendingSnapshot.current;
        pendingSnapshot.current = null;
        if (!snapshot) return;

        // Skip when only derived/output state changed (processedLayers, vectorSvg,
        // isProcessing, ditherComposite, etc.) — those aren't in the snapshot, so
        // the "before" and "current" snapshots would be identical.
        const currentSnap = captureSnapshot(useStore.getState());
        if (JSON.stringify(currentSnap) === JSON.stringify(snapshot)) return;

        useStore.getState().pushHistorySnapshot(snapshot);
      }, 300);
    });

    return () => {
      clearTimeout(debounceTimer.current);
      unsubscribe();
    };
  }, []);
}
