import Link from 'next/link';
import { Leaf } from 'lucide-react';
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
    <div className="flex min-h-dvh w-full overflow-hidden bg-white duration-300 animate-in fade-in">
      {/* Left Branding Area */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-[#FDF8F6] p-12 lg:flex xl:p-20">
        <Image src="/maple.png" alt="Branding background" fill className="object-cover opacity-80 mix-blend-multiply pointer-events-none" priority />

        <Link href="/" className="relative z-10 flex w-max items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-md text-primary-foreground">
            <Leaf className="h-5 w-5" />
          </div>
          <span className="text-2xl font-semibold tracking-tight text-primary">Dripl</span>
        </Link>
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-4xl font-bold tracking-tight text-foreground leading-tight">
            Move ideas from rough to ready.
          </h2>
          <p className="text-lg text-muted-foreground">
            Continue organizing your thoughts, wireframes, and collections in one calm workspace.
          </p>
        </div>
      </div>

      {/* Right Content Area */}
      <div className="flex w-full items-center justify-center p-6 sm:p-12 lg:w-1/2 bg-white">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex flex-col items-center space-y-3 text-center sm:items-start sm:text-left">
            {/* Mobile Logo */}
            <Link href="/" className="mb-4 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-md text-primary-foreground">
                <Leaf className="h-5 w-5" />
              </div>
              <span className="text-xl font-semibold tracking-tight text-primary">Dripl</span>
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="text-[15px] text-muted-foreground">{subtitle}</p>
          </div>
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              >
                {children}
                {footer && <div className="mt-8 border-t border-border/50 pt-6">{footer}</div>}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
