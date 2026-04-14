'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, PenLine, Users, CalendarRange, Layers3 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const features = [
  {
    title: 'Visual Planning',
    description: 'Map ideas spatially instead of burying them in rows and tabs.',
    stat: '∞ canvas',
  },
  {
    title: 'Live Collaboration',
    description: 'Cursors, comments, and edits stay in sync while your team works.',
    stat: 'Real-time',
  },
  {
    title: 'Shareable Boards',
    description: 'Send clean links to teammates and clients with controlled access.',
    stat: 'One-click',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  return (
    <main className="min-h-dvh bg-[#f6f0e7] text-[#1a1612]">
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-10 md:px-10 md:pt-14">
        <header className="mb-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f1a14] text-[#f6f0e7] shadow-md">
              <PenLine className="h-4 w-4" />
            </div>
            <span className="text-xl font-semibold tracking-tight">Dripl</span>
          </Link>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1 rounded-full border border-[#2d241a]/20 bg-[#f9f4ec] px-4 py-2 text-sm font-medium text-[#2d241a] transition-colors hover:bg-white"
          >
            Sign in <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </header>

        <section className="grid items-start gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6d6358]">
              Collaborative Canvas
            </p>
            <h1 className="mt-4 text-5xl leading-[1.02] tracking-tight md:text-7xl">
              Plan work in space,
              <br />
              not spreadsheets.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#544b40]">
              Dripl helps teams turn messy ideas into clear, scheduled deliverables. Sketch, group,
              and ship together on a single infinite board.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/auth/register"
                className="rounded-xl bg-[#1f1a14] px-5 py-3 text-sm font-semibold text-[#f6f0e7] transition-colors hover:bg-[#2d241a]"
              >
                Start free workspace
              </Link>
              <Link
                href="/auth/login"
                className="rounded-xl border border-[#2d241a]/20 bg-white/70 px-5 py-3 text-sm font-semibold text-[#2d241a] transition-colors hover:bg-white"
              >
                Open existing board
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-[#2d241a]/12 bg-white/75 p-5 shadow-[0_18px_35px_-24px_rgba(17,12,8,0.55)] backdrop-blur-sm">
            <div className="rounded-2xl border border-[#2d241a]/10 bg-[#fbf7f2] p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-[#6d6358]">
                <span>Q2 Content Board</span>
                <span>Synced now</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#d9cdbf] bg-[#fffdf9] p-3">
                  <Users className="h-4 w-4 text-[#785f41]" />
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#6d6358]">
                    Team
                  </p>
                  <p className="mt-1 text-sm font-medium">Design + Growth</p>
                </div>
                <div className="rounded-xl border border-[#d9cdbf] bg-[#fffdf9] p-3">
                  <CalendarRange className="h-4 w-4 text-[#785f41]" />
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#6d6358]">
                    Sprint
                  </p>
                  <p className="mt-1 text-sm font-medium">Week 14</p>
                </div>
                <div className="col-span-2 rounded-xl border border-[#d9cdbf] bg-[#fffdf9] p-3">
                  <Layers3 className="h-4 w-4 text-[#785f41]" />
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#6d6358]">
                    Active Boards
                  </p>
                  <p className="mt-1 text-sm font-medium">Campaign timeline, launch retro, social queue</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {features.map(feature => (
            <article
              key={feature.title}
              className="rounded-2xl border border-[#2d241a]/12 bg-white/65 p-5 shadow-[0_14px_30px_-26px_rgba(17,12,8,0.45)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6d6358]">
                {feature.stat}
              </p>
              <h2 className="mt-2 text-xl leading-tight">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#544b40]">{feature.description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
