'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PenLine, Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'FAQ', href: '#faq' },
];

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <nav
      className={`sticky top-0 z-50 mx-auto max-w-5xl border-b transition-all duration-200 [linear-gradient(to_right,transparent,black_64px,black_calc(100%-64px),transparent)] ${
        scrolled
          ? 'border-[#E4E0D9] bg-[#F0EDE6]/95 shadow-sm backdrop-blur-md'
          : 'border-[#E4E0D9] bg-[#F0EDE6]/90 backdrop-blur-sm'
      }`}
    >
      <div className="flex items-center justify-between px-6 py-3.5 md:px-10">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8462A] text-white">
            <PenLine className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-[#E8462A]">Dripl</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] text-[#6B6860] transition-colors hover:text-[#1A1917]"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-[13px] font-medium text-[#6B6860] transition-colors hover:bg-[#E8E5DE] hover:text-[#1A1917]"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-md bg-[#E8462A] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#D93D22]"
          >
            Get started free
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen((o) => !o)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-[#6B6860] transition-colors hover:bg-[#E8E5DE] hover:text-[#1A1917] md:hidden"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile slide-down panel */}
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-250 ease-in-out md:hidden ${
          mobileOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-[#E4E0D9] bg-[#FAFAF7] px-6 py-4">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-3 py-2 text-[14px] text-[#6B6860] transition-colors hover:bg-[#E8E5DE] hover:text-[#1A1917]"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 border-t border-[#E4E0D9] pt-3">
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="inline-flex items-center justify-start rounded-md px-3 py-2 text-[14px] font-medium text-[#6B6860] transition-colors hover:bg-[#E8E5DE] hover:text-[#1A1917]"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              onClick={() => setMobileOpen(false)}
              className="inline-flex items-center justify-center rounded-md bg-[#E8462A] px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-[#D93D22]"
            >
              Get started free
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
