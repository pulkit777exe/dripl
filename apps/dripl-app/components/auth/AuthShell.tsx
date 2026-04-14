import Link from 'next/link';
import { PenLine } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh w-full overflow-hidden">
      {/* Left — Maple image fills entire panel */}
      <div className="relative hidden w-[52%] lg:block">
        <Image
          src="/maple.png"
          alt=""
          fill
          className="object-cover pointer-events-none"
          priority
        />
      </div>

      {/* Right — Form panel */}
      <div className="flex w-full flex-col items-center justify-center bg-[#F5F3EE] px-6 py-10 sm:px-12 lg:w-[48%]">
        <div className="w-full max-w-[380px]">
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
  );
}
