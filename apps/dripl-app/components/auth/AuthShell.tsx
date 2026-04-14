import Link from 'next/link';
import { PenLine } from 'lucide-react';

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="auth-shell relative min-h-dvh overflow-hidden">
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl items-center gap-8 px-4 py-8 sm:px-8 lg:gap-12">
        <div className="hidden w-full max-w-sm flex-col gap-6 rounded-3xl border border-border/70 bg-card/75 p-8 shadow-lg backdrop-blur-sm lg:flex">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/95 text-primary-foreground shadow-md">
              <PenLine className="h-4 w-4" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-foreground">Dripl</span>
          </Link>
          <div className="space-y-2">
            <p className="text-3xl leading-tight text-foreground">Move ideas from rough to ready.</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Plan visually, collaborate in real time, and ship with confidence.
            </p>
          </div>
        </div>

        <div className="w-full max-w-md lg:ml-auto">
          <div className="rounded-3xl border border-border/70 bg-card/90 p-6 shadow-xl backdrop-blur-sm sm:p-8">
            <div className="mb-8 space-y-2 text-center">
              <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {children}
            {footer && <div className="mt-8 border-t border-border/50 pt-5">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
