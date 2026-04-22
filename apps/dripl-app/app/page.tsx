'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  PenLine,
  MousePointerClick,
  Layout,
  Share2,
  Undo2,
  Download,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Spinner } from '@/components/button/Spinner';

/* ----------  FAQ data  ---------- */
const faqs = [
  {
    q: 'Is Dripl free to use?',
    a: 'Yes. The free plan gives you the core canvas workflow. Upgrade only when you need advanced team controls.',
  },
  {
    q: 'What makes Dripl different from other whiteboard tools?',
    a: 'Dripl focuses on speed, sharing, and clean collaboration defaults for small product teams.',
  },
  {
    q: 'Can I collaborate with my team in real-time?',
    a: 'Yes. Invite collaborators with a link and edits sync live with presence indicators.',
  },
  {
    q: 'How do I export my work?',
    a: 'Export as PNG, SVG, or JSON whenever you need artifacts outside Dripl.',
  },
];

/* ----------  Feature cards  ---------- */
const features = [
  {
    icon: Layout,
    title: 'Infinite canvas',
    desc: 'Sketch and organize ideas without page limits.',
  },
  {
    icon: MousePointerClick,
    title: 'Real-time cursors',
    desc: 'Track who is editing what, in real time.',
  },
  {
    icon: Share2,
    title: 'One-click sharing',
    desc: 'Share boards with a link instead of attachments.',
  },
  {
    icon: Undo2,
    title: 'Undo / Redo history',
    desc: 'Safe editing with revision history built in.',
  },
  {
    icon: Download,
    title: 'PNG, SVG & JSON export',
    desc: 'Export into the format your workflow needs.',
  },
  {
    icon: Sparkles,
    title: 'AI generation',
    desc: 'Start diagrams from prompts, then edit manually.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-[#F0EDE6]">
        <Spinner className="size-8 text-[#E8462A]" />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#F0EDE6] text-[#1A1917] font-sans selection:bg-[#FAE8E5]">
      {/* ═══════════  NAVBAR  ═══════════ */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 bg-[#F0EDE6]/90 backdrop-blur-sm border-b border-[#E4E0D9]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8462A] text-white">
            <PenLine className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-[#E8462A]">Dripl</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <a
            href="#features"
            className="text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
          >
            Features
          </a>
          <a
            href="#how"
            className="text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
          >
            How it works
          </a>
          <a
            href="#faq"
            className="text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
          >
            FAQ
          </a>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-[13px] font-medium text-[#6B6860] hover:text-[#1A1917] transition-colors hidden sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-[#E8462A] px-4 py-1.75 text-[13px] font-medium text-white transition-colors hover:bg-[#D93D22]"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* ═══════════  HERO  ═══════════ */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 md:px-10 md:pt-28 md:pb-24 font-ui">
        <div className="max-w-2xl">
          <h1 className="text-[40px] leading-[1.05] font-semibold tracking-tight md:text-[56px]">
            Save every idea that matters.
            <br />
            <span className="font-handwritten text-[#E8462A] text-[42px] md:text-[58px]">
              Find it again, fast.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-[#6B6860]">
            Dripl is a collaborative canvas for product teams. Capture ideas, shape direction, and
            share decisions in one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-md bg-[#E8462A] px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#D93D22]"
            >
              Start for free
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-[#D4D0C9] bg-transparent px-5 py-2.5 text-[13px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE]"
            >
              Open workspace
            </Link>
          </div>
        </div>

        {/* Product mock */}
        <div className="mt-14 rounded-xl border border-[#D4D0C9] bg-[#FAFAF7] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-2 border-b border-[#E4E0D9] bg-[#F0EDE6] px-4 py-2.5">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#D4D0C9]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#D4D0C9]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#D4D0C9]" />
            </div>
            <span className="ml-2 text-[11px] text-[#9B9890]">dripl.app/canvas/q2-board</span>
          </div>
          <div className="relative h-80 md:h-105 bg-[#FAFAF7] flex items-center justify-center">
            {/* Skeleton grid lines */}
            <div
              className="absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #D4D0C9 1px, transparent 1px), linear-gradient(to bottom, #D4D0C9 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />

            {/* Floating cards */}
            <div className="absolute top-8 left-8 md:top-12 md:left-16 w-56 rounded-lg border border-[#E4E0D9] bg-white p-4 shadow-sm -rotate-1">
              <div className="h-3 w-20 rounded bg-[#E8E5DE] mb-3" />
              <div className="space-y-2">
                <div className="h-2 w-full rounded bg-[#E8E5DE]" />
                <div className="h-2 w-4/5 rounded bg-[#E8E5DE]" />
                <div className="h-2 w-3/5 rounded bg-[#E8E5DE]" />
              </div>
            </div>

            <div className="absolute top-16 right-8 md:top-20 md:right-20 w-48 rounded-lg border border-[#E4E0D9] bg-white p-4 shadow-sm rotate-1">
              <div className="h-24 w-full rounded bg-[#FAE8E5] mb-2" />
              <div className="h-2 w-1/2 rounded bg-[#E8E5DE]" />
            </div>

            <div className="absolute bottom-12 left-1/3 w-64 rounded-lg border border-[#E4E0D9] bg-white p-4 shadow-sm rotate-[0.5deg]">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-[#E8462A]/15" />
                <div className="h-2.5 w-24 rounded bg-[#E8E5DE]" />
              </div>
              <div className="h-2 w-full rounded bg-[#E8E5DE]" />
              <div className="h-2 w-3/4 rounded bg-[#E8E5DE] mt-2" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════  PROBLEM STATEMENT  ═══════════ */}
      <section id="how" className="py-20 text-center px-6 font-ui">
        <h2 className="text-[28px] md:text-[36px] font-medium tracking-tight leading-tight">
          Your ideas are scattered.
          <br />
          They don&apos;t have to be.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-[#6B6860] leading-relaxed">
          Replace scattered docs and screenshots with one shared workspace that stays easy to scan.
        </p>
      </section>

      {/* ═══════════  FEATURES GRID  ═══════════ */}
      <section id="features" className="mx-auto max-w-5xl px-6 py-16 md:px-10 font-ui">
        <h2 className="text-[24px] font-medium tracking-tight mb-10">
          Built so you actually use it
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(f => (
            <article
              key={f.title}
              className="group rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] p-5 transition-colors hover:bg-white"
            >
              <f.icon className="h-5 w-5 text-[#E8462A] mb-4" />
              <h3 className="text-[15px] font-medium mb-1">{f.title}</h3>
              <p className="text-[13px] leading-relaxed text-[#6B6860]">{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ═══════════  CTA BANNER  ═══════════ */}
      <section className="relative mx-auto max-w-5xl px-6 py-20 md:px-10">
        <div className="relative overflow-hidden rounded-2xl bg-[#FAFAF7] border border-[#E4E0D9]">
          {/* Maple leaf background */}
          <div className="absolute inset-0">
            <Image
              src="/maple.png"
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-30 mix-blend-multiply pointer-events-none"
            />
          </div>
          <div className="relative z-10 flex flex-col items-center py-20 px-6 text-center">
            <p className="text-[15px] text-[#6B6860] mb-2">
              Keep every decision and draft in one place.
            </p>
            <div className="flex items-center gap-2 mb-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E8462A] text-white">
                <PenLine className="h-4 w-4" />
              </div>
              <span className="text-3xl font-semibold tracking-tight text-[#E8462A]">Dripl</span>
            </div>
            <p className="font-handwritten text-[#E8462A] text-[30px] mb-4">
              simple, clean, collaborative
            </p>
            <Link
              href="/signup"
              className="rounded-md bg-[#E8462A] px-6 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#D93D22]"
            >
              Create your workspace
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════  FAQ  ═══════════ */}
      <section id="faq" className="mx-auto max-w-2xl px-6 py-16 font-ui">
        <h2 className="text-center text-[24px] font-medium tracking-tight mb-10">FAQ</h2>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="border border-[#E4E0D9] rounded-lg bg-[#FAFAF7] overflow-hidden"
            >
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
      </section>

      {/* ═══════════  FOOTER  ═══════════ */}
      <footer className="border-t border-[#E4E0D9] bg-[#FAFAF7] py-10 px-6 md:px-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 md:flex-row md:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#E8462A] text-white">
              <PenLine className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-[#E8462A]">Dripl</span>
          </div>
          <div className="flex gap-6 text-[12px] text-[#9B9890]">
            <a href="#" className="hover:text-[#1A1917] transition-colors">
              Product
            </a>
            <a href="#" className="hover:text-[#1A1917] transition-colors">
              Changelog
            </a>
            <a href="#" className="hover:text-[#1A1917] transition-colors">
              Careers
            </a>
            <a href="#" className="hover:text-[#1A1917] transition-colors">
              Twitter
            </a>
            <a href="#" className="hover:text-[#1A1917] transition-colors">
              GitHub
            </a>
          </div>
          <p className="text-[11px] text-[#9B9890]">
            © {new Date().getFullYear()} Dripl. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
