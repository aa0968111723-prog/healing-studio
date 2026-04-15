import { useRef } from "react";
import { usePersistFn } from "./usePersistFn";

export interface UseCompositionReturn<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  onCompositionStart: React.CompositionEventHandler<T>;
  onCompositionEnd: React.CompositionEventHandler<T>;
  onKeyDown: React.KeyboardEventHandler<T>;
  isComposing: () => boolean;
}

export interface UseCompositionOptions<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  onKeyDown?: React.KeyboardEventHandler<T>;
  onCompositionStart?: React.CompositionEventHandler<T>;
  onCompositionEnd?: React.CompositionEventHandler<T>;
}

export function useComposition<
  T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement,
>(options: UseCompositionOptions<T> = {}): UseCompositionReturn<T> {
  const {
    onKeyDown: originalOnKeyDown,
    onCompositionStart: originalOnCompositionStart,
    onCompositionEnd: originalOnCompositionEnd,
  } = options;

  const c = useRef(false);
  // Track compositionEnd timestamp for Safari timing workaround
  const compositionEndTimeRef = useRef(0);
  // Safari fires keyDown within a few ms of compositionEnd; this grace period catches those events
  const COMPOSITION_END_GRACE_MS = 10;

  const onCompositionStart = usePersistFn((e: React.CompositionEvent<T>) => {
    c.current = true;
    compositionEndTimeRef.current = 0;
    originalOnCompositionStart?.(e);
  });

  const onCompositionEnd = usePersistFn((e: React.CompositionEvent<T>) => {
    // Use a single short setTimeout to handle Safari's compositionEnd→keyDown ordering issue.
    // Record the timestamp so onKeyDown can ignore events immediately following compositionEnd.
    compositionEndTimeRef.current = e.timeStamp;
    setTimeout(() => {
      c.current = false;
    }, 0);
    originalOnCompositionEnd?.(e);
  });

  const onKeyDown = usePersistFn((e: React.KeyboardEvent<T>) => {
    // In Safari, keyDown may fire right after compositionEnd with ~0ms gap.
    // Use timeStamp comparison as an extra safeguard.
    const isJustAfterComposition =
      c.current ||
      (compositionEndTimeRef.current > 0 &&
        Math.abs(e.timeStamp - compositionEndTimeRef.current) <
          COMPOSITION_END_GRACE_MS);

    if (
      isJustAfterComposition &&
      (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))
    ) {
      e.stopPropagation();
      return;
    }
    originalOnKeyDown?.(e);
  });

  const isComposing = usePersistFn(() => {
    return c.current;
  });

  return {
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
    isComposing,
  };
}
