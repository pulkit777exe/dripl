import { FilePlus, Sparkles, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 text-center', className)}>
      {icon && (
        <div className="w-24 h-24 mb-6 flex items-center justify-center rounded-2xl bg-[#FAE8E5]/30">
          {icon}
        </div>
      )}
      <h3 className="text-[16px] font-semibold text-[#1A1917] mb-2">{title}</h3>
      <p className="text-[14px] text-[#6B6860] max-w-sm mb-6 leading-relaxed">
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-md text-[13px] font-medium transition-all',
            action.variant === 'primary'
              ? 'bg-[#E8462A] text-white hover:bg-[#D93D22] shadow-sm'
              : 'border border-[#D4D0C9] bg-white text-[#1A1917] hover:bg-[#E8E5DE]'
          )}
        >
          {action.label}
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

interface EmptyStateVariantProps {
  onCreateCanvas?: () => void;
  className?: string;
}

export function EmptyFilesState({ onCreateCanvas, className }: EmptyStateVariantProps) {
  return (
    <EmptyState
      icon={<FilePlus className="w-10 h-10 text-[#E8462A]" />}
      title="No canvases yet"
      description="Start by creating your first canvas. Your work will appear here as you build your collection."
      action={{
        label: 'Create your first canvas',
        onClick: onCreateCanvas || (() => {}),
        variant: 'primary',
      }}
      className={className}
    />
  );
}

export function EmptySearchState({ onCreateCanvas, className }: EmptyStateVariantProps) {
  return (
    <EmptyState
      icon={<Sparkles className="w-10 h-10 text-[#6B6860]" />}
      title="No results found"
      description="Try adjusting your search terms or create a new canvas to get started."
      action={{
        label: 'Create new canvas',
        onClick: onCreateCanvas || (() => {}),
        variant: 'secondary',
      }}
      className={className}
    />
  );
}