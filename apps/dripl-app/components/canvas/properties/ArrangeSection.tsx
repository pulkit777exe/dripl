'use client';

import { useCanvasStore } from '@/lib/store';
import { ARRANGE_BUTTON_CLASS, SectionLabel } from './PanelPrimitives';

/** Multi-selection arrange grid (shown when more than one element is selected). */
export function ArrangeSection() {
  const alignElements = useCanvasStore(s => s.alignElements);
  const distributeElements = useCanvasStore(s => s.distributeElements);

  return (
    <section className="space-y-1.5" aria-label="Align and distribute selected elements">
      <SectionLabel>Arrange</SectionLabel>
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => alignElements('left')}
          title="Align left"
          aria-label="Align left"
        >
          L
        </button>
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => alignElements('center')}
          title="Align horizontal centers"
          aria-label="Align horizontal centers"
        >
          C
        </button>
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => alignElements('right')}
          title="Align right"
          aria-label="Align right"
        >
          R
        </button>
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => alignElements('top')}
          title="Align top"
          aria-label="Align top"
        >
          T
        </button>
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => alignElements('middle')}
          title="Align vertical centers"
          aria-label="Align vertical centers"
        >
          M
        </button>
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => alignElements('bottom')}
          title="Align bottom"
          aria-label="Align bottom"
        >
          B
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => distributeElements('horizontal')}
          title="Distribute horizontally"
          aria-label="Distribute horizontally"
        >
          Distribute H
        </button>
        <button
          type="button"
          className={ARRANGE_BUTTON_CLASS}
          onClick={() => distributeElements('vertical')}
          title="Distribute vertically"
          aria-label="Distribute vertically"
        >
          Distribute V
        </button>
      </div>
    </section>
  );
}
