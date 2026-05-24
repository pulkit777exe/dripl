'use client';

import { useRef, useEffect } from 'react';
import Link from 'next/link';
import { PenLine } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  isError?: boolean;
  onErrorShake?: () => void;
};

export function AuthShell({ title, subtitle, children, footer, isError, onErrorShake }: AuthShellProps) {
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isError || !inputRef.current) return;
    const el = inputRef.current;
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
    const shakeMs = 80 * 2 + 60 * 2;
    setTimeout(() => {
      el.classList.remove('is-shaking');
      onErrorShake?.();
    }, shakeMs + 20);
  }, [isError]);

  return (
    <div className="flex min-h-dvh w-full overflow-hidden">
      {/* Left — Maple image fills entire panel */}
      <div className="relative hidden w-[52%] lg:block">
        <Image
          src="/maple.png"
          alt=""
          fill
          sizes="52vw"
          className="object-cover pointer-events-none"
          priority
        />
      </div>

      {/* Right — Form panel */}
      <div className="flex w-full flex-col items-center justify-center bg-[#F5F3EE] px-6 py-10 sm:px-12 lg:w-[48%]">
        <div className="w-full max-w-95">
          {/* Logo */}
          <div className="mb-8 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8462A] text-white">
              <PenLine className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-[#E8462A]">Dripl</span>
          </div>

          {/* Heading */}
          <h1 className="text-xl font-semibold text-[#1A1917] mb-1">{title}</h1>
          <p className="text-[13px] text-[#6B6860] mb-6">{subtitle}</p>

          {/* Form content */}
          <div className="t-input-wrap">
            <div className={`t-input ${isError ? 'is-error' : ''}`} ref={inputRef}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {children}
                  {footer && <div className="mt-6 pt-5 border-t border-[#E4E0D9]">{footer}</div>}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
