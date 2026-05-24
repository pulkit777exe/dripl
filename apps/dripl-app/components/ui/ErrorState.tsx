import { AlertCircle, RefreshCw, X, Info, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'error' | 'warning' | 'info';
  className?: string;
}

export function ErrorState({
  title,
  message,
  onRetry,
  onDismiss,
  variant = 'error',
  className,
}: ErrorStateProps) {
  const icons = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colors = {
    error: {
      bg: 'bg-[#FEF3F2]',
      border: 'border-[#FECACA]',
      text: 'text-[#B42318]',
      icon: 'text-[#e03131]',
    },
    warning: {
      bg: 'bg-[#FFFBEB]',
      border: 'border-[#FED7AA]',
      text: 'text-[#92400E]',
      icon: 'text-[#d97706]',
    },
    info: {
      bg: 'bg-[#EFF6FF]',
      border: 'border-[#BFDBFE]',
      text: 'text-[#1E40AF]',
      icon: 'text-[#3B82F6]',
    },
  };

  const Icon = icons[variant];
  const color = colors[variant];

  return (
    <div className={cn('rounded-lg border p-4 t-error-msg', color.bg, color.border, className)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', color.icon)} />
        <div className="flex-1 min-w-0">
          <h4 className={cn('text-[14px] font-semibold mb-1', color.text)}>{title}</h4>
          <p className={cn('text-[13px]', color.text)}>{message}</p>
          {(onRetry || onDismiss) && (
            <div className="flex items-center gap-2 mt-3">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-[#D4D0C9] text-[13px] font-medium text-[#1A1917] hover:bg-[#E8E5DE] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Try again
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1 text-[#9B9890] hover:text-[#1A1917] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ message, onRetry, className }: InlineErrorProps) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-md bg-[#FEF3F2] border border-[#FECACA] t-error-msg', className)}>
      <AlertCircle className="w-4 h-4 text-[#e03131] flex-shrink-0" />
      <p className="text-[12px] text-[#B42318] flex-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex-shrink-0 text-[12px] text-[#e03131] hover:text-[#c2252d] font-medium transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

interface SuccessStateProps {
  title: string;
  message?: string;
  onDismiss?: () => void;
  className?: string;
}

export function SuccessState({ title, message, onDismiss, className }: SuccessStateProps) {
  return (
    <div className={cn('rounded-lg border p-4 bg-[#F0FDF4] border-[#BBF7D0]', className)}>
      <div className="flex items-start gap-3">
        <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-[#059669]" />
        <div className="flex-1 min-w-0">
          <h4 className="text-[14px] font-semibold text-[#065F46] mb-1">{title}</h4>
          {message && <p className="text-[13px] text-[#047857]">{message}</p>}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1 text-[#6B7280] hover:text-[#1A1917] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

interface WarningBannerProps {
  message: string;
  onDismiss?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function WarningBanner({ message, onDismiss, action, className }: WarningBannerProps) {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 rounded-md bg-[#FFFBEB] border border-[#FED7AA]', className)}>
      <AlertTriangle className="w-4 h-4 text-[#d97706] flex-shrink-0" />
      <p className="text-[13px] text-[#92400E] flex-1">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="flex-shrink-0 text-[13px] font-medium text-[#d97706] hover:text-[#b45309] transition-colors"
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 text-[#9B9890] hover:text-[#1A1917] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function LoadingState({ message = 'Loading...', className }: { message?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-3 px-4 py-3', className)}>
      <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      <p className="text-[13px] text-[#6B6860]">{message}</p>
    </div>
  );
}
