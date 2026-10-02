'use client';

import { useEffect, useRef, useState } from 'react';

export type ModalAnimState = 'closed' | 'opening' | 'open' | 'closing';

/**
 * Mount/animate/unmount lifecycle shared by canvas modals.
 *
 * Extracted from the identical logic in `ExportModal`/`ShareModal` (and
 * several siblings): mount on first render, `opening` → rAF → `open` on
 * show, `closing` → CSS-duration timeout → `closed` (unmounted) on hide.
 * `modalState` maps to the `t-modal` CSS classes (`is-open`/`is-closing`).
 */
export function useModalAnimation(isOpen: boolean) {
  const [mounted, setMounted] = useState(false);
  const [animState, setAnimState] = useState<ModalAnimState>('closed');
  const prevOpen = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      prevOpen.current = true;
      setAnimState('opening');
    } else if (!isOpen && prevOpen.current) {
      prevOpen.current = false;
      setAnimState('closing');
    }
  }, [isOpen]);

  useEffect(() => {
    if (animState === 'opening') {
      const raf = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(raf);
    }
    if (animState === 'closing') {
      const ms =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
        ) || 150;
      const timer = setTimeout(() => setAnimState('closed'), ms);
      return () => clearTimeout(timer);
    }
  }, [animState]);

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

  return {
    animState,
    modalState,
    /** Render gate: `!mounted || animState === 'closed'` unmounts. */
    isVisible: mounted && animState !== 'closed',
  };
}
