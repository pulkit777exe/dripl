import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { FaqAccordion, type Faq } from '@/components/landing/FaqAccordion';

/**
 * `components/landing/FaqAccordion.tsx` is the only stateful part of the landing
 * page — the reason the whole route has `'use client'` on it. One piece of
 * state, one toggle expression, and a chevron whose rotation is derived from the
 * same comparison.
 *
 * The toggle is `openFaq === i ? null : i`, which is worth pinning from both
 * sides, because the two failure modes look identical in the UI:
 *
 *   always setting `i` makes every click open rather than toggle, so a question
 *     the user opened in order to re-read it closes on the second click instead
 *     of closing. The test asserts the *second* click closes it, not just that
 *     the first opened it.
 *   always setting `null` never opens anything, and a test that only asserted
 *     "the answer is hidden after a click" would pass against it — so every
 *     closed-state assertion here is paired with an open-state one.
 *
 * The chevron rotation is derived from the same comparison rather than from
 * state, so it is asserted per item: a rotation applied to every chevron, or to
 * none, is the regression.
 *
 * The questions stay an argument (they are content, and content belongs on the
 * server), so the copy is the fixture and every structural expectation is
 * derived from its length rather than restated.
 */

afterEach(() => {
  cleanup();
});

const FAQS: Faq[] = [
  { q: 'Is there a free tier?', a: 'Yes, three canvases forever.' },
  { q: 'Can I collaborate in real time?', a: 'Share a room and edit together.' },
  { q: 'Where is my data stored?', a: 'In a Postgres row you own.' },
];

/** The question buttons, in fixture order. */
function questionButtons(): HTMLElement[] {
  return screen.queryAllByRole('button');
}

/**
 * The chevron inside a question button.
 *
 * `lucide-react` renders an `<svg>`, and `className` on an SVG element is an
 * `SVGAnimatedString` rather than a string -- so the class list is read through
 * `getAttribute`. Reading `.className` here would look like it worked (the
 * object stringifies to something plausible in a failure message) while every
 * `.includes` on it threw.
 */
function chevronOf(button: HTMLElement): SVGSVGElement {
  const icon = button.querySelector('svg');
  if (!icon) throw new Error('no chevron rendered');
  return icon;
}

/**
 * An SVG element's class list, read as a string.
 *
 * `SVGSVGElement` has no string `className` -- the property is an
 * `SVGAnimatedString` -- so `getAttribute` is the only way to read it.
 */
function classesOf(svg: SVGSVGElement): string {
  return svg.getAttribute('class') ?? '';
}

/** A question's answer, when it is open. */
function answer(text: string) {
  return screen.queryByText(text);
}

describe('FaqAccordion', () => {
  // Regression: nothing is open on arrival. The landing page is a static
  // prerender, so an accordion that defaulted to its first item open would ship
  // a permanently expanded answer in the first HTML response -- and the
  // `openFaq` initial value of `null` is the only thing that prevents it.
  it('renders every question closed on arrival', () => {
    render(<FaqAccordion faqs={FAQS} />);

    expect(questionButtons()).toHaveLength(FAQS.length);
    for (const faq of FAQS) {
      expect(answer(faq.a)).toBeNull();
      // And the question text itself is present, so a missing answer is a
      // closed state rather than missing content.
      expect(screen.getByText(faq.q)).toBeInTheDocument();
    }
  });

  // Regression: the working direction. A click opens that question's answer.
  // Paired with every closed-state assertion above, so an always-null toggle
  // cannot pass this file.
  it('opens the answer for the question that was clicked', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={FAQS} />);

    await user.click(questionButtons()[1]!);

    expect(answer(FAQS[1]!.a)).not.toBeNull();
    expect(answer(FAQS[1]!.a)).toBeInTheDocument();
  });

  // Regression: the toggle. The same question clicked twice closes again. This
  // is the assertion that separates `openFaq === i ? null : i` from a plain
  // `setOpenFaq(i)`, and it is the one that matters: a user who opens an answer to
  // check something and clicks again expects it to collapse.
  it('closes an open answer when the same question is clicked again', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={FAQS} />);

    const second = questionButtons()[1]!;
    await user.click(second);
    expect(answer(FAQS[1]!.a)).not.toBeNull();

    await user.click(second);
    expect(answer(FAQS[1]!.a)).toBeNull();
  });

  // Regression: only one answer at a time. `openFaq` is a single index rather
  // than a set, so opening a second question closes the first. Asserted in both
  // directions -- the newly opened one is visible, the previously open one is
  // gone -- because "at most one is open" is also satisfied by "none ever are".
  it('moves the open answer rather than accumulating them', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={FAQS} />);

    await user.click(questionButtons()[0]!);
    expect(answer(FAQS[0]!.a)).not.toBeNull();

    await user.click(questionButtons()[2]!);
    expect(answer(FAQS[2]!.a)).not.toBeNull();
    expect(answer(FAQS[0]!.a)).toBeNull();
    expect(answer(FAQS[1]!.a)).toBeNull();
  });

  // Regression: the chevron rotation is derived from `openFaq === i`, so exactly
  // the open item's chevron is rotated. Asserted as a per-item invariant: a
  // rotation applied to every chevron (a class hoisted onto the container) or to
  // none both pass a bare "contains rotate-180" check.
  it('rotates only the open question chevron', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={FAQS} />);

    await user.click(questionButtons()[1]!);

    const chevrons = questionButtons().map(chevronOf);
    const rotated = chevrons.filter(c => classesOf(c).includes('rotate-180'));
    expect(rotated).toHaveLength(1);
    expect(rotated[0]).toBe(chevrons[1]);
    // The rotation is additive: the sizing and colour classes are not replaced
    // by the conditional one, so `classesOf` is compared as a token list.
    expect(classesOf(chevrons[1]!).split(' ')).toEqual(
      expect.arrayContaining(['h-4', 'w-4', 'text-[#9B9890]', 'transition-transform', 'rotate-180'])
    );
    for (const unrotated of [chevrons[0]!, chevrons[2]!]) {
      expect(classesOf(unrotated)).not.toContain('rotate-180');
      expect(classesOf(unrotated).split(' ')).toEqual(expect.arrayContaining(['h-4', 'w-4']));
    }
  });

  // Regression: closing un-rotates. Without this the chevron would stay pointing
  // at the answer that is no longer there, which is the most visible half of a
  // broken toggle.
  it('un-rotates the chevron when the answer closes', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={FAQS} />);

    const first = questionButtons()[0]!;
    await user.click(first);
    expect(classesOf(chevronOf(first))).toContain('rotate-180');

    await user.click(first);
    expect(classesOf(chevronOf(first))).not.toContain('rotate-180');
  });

  // Regression: the answers are keyed off the same index the state uses, so the
  // rendered copy has to match the question it sits under. Reading the answer out
  // of the card that owns its question is what catches an off-by-one in the
  // `map`, which a "some answer is visible" check would not.
  it('renders each answer inside the card of its own question', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={FAQS} />);

    await user.click(questionButtons()[2]!);

    const cards = [...document.querySelectorAll('.border.rounded-lg')] as HTMLElement[];
    expect(cards).toHaveLength(FAQS.length);
    for (const [index, faq] of FAQS.entries()) {
      expect(cards[index]!.textContent).toContain(faq.q);
      if (index === 2) {
        expect(cards[index]!.textContent).toContain(faq.a);
      } else {
        expect(cards[index]!.textContent).not.toContain(faq.a);
      }
    }
  });

  // Regression: the questions stay an argument rather than being imported, so an
  // empty list is legal and renders nothing rather than throwing. The map over an
  // empty array is the whole of the branch, so this is a real case rather than a
  // formality.
  it('renders an empty list without a question or an answer', () => {
    render(<FaqAccordion faqs={[]} />);

    expect(questionButtons()).toHaveLength(0);
  });
});
