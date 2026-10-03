'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * The FAQ accordion, split out of `app/page.tsx` so the landing page can be a
 * Server Component.
 *
 * The accordion is the only part of the page that needs to hold state, and
 * state is what forces `'use client'` on the whole module. Everything else —
 * hero, feature grid, CTA, footer — is static markup that belongs in the HTML
 * the server sends, which is the entire point of the split: before it, the page
 * shipped a full-viewport spinner and waited for a client round trip to
 * `/auth/me` before the hero could paint at all.
 *
 * The questions stay an argument rather than moving here, because the copy is
 * content and the server is where content belongs.
 */
export type Faq = {
  q: string;
  a: string;
};

export function FaqAccordion({ faqs }: { faqs: Faq[] }) {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {faqs.map((faq, i) => (
        <div key={i} className="border border-[#E4E0D9] rounded-lg bg-[#FAFAF7] overflow-hidden">
          <button
            onClick={() => setOpenFaq(openFaq === i ? null : i)}
            className="flex w-full items-center justify-between px-5 py-4 text-left text-[14px] font-medium hover:bg-white transition-colors"
          >
            {faq.q}
            <ChevronDown
              className={`h-4 w-4 text-[#9B9890] transition-transform ${openFaq === i ? 'rotate-180' : ''}`}
            />
          </button>
          {openFaq === i && (
            <div className="px-5 pb-4 text-[13px] leading-relaxed text-[#6B6860]">{faq.a}</div>
          )}
        </div>
      ))}
    </div>
  );
}
