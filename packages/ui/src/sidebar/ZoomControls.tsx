import { cn } from "../lib/utils";
import { IconButton } from "../common/IconButton";
import { Tooltip } from "../common/Tooltip";

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  className?: string;
}

export const ZoomControls = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  className,
}: ZoomControlsProps) => {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-xl p-1",
        "bg-neutral-100 dark:bg-neutral-800",
        "border border-neutral-200 dark:border-neutral-700",
        className
      )}
    >
      <Tooltip content="Zoom Out (-)">
        <IconButton size="sm" onClick={onZoomOut}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
          </svg>
        </IconButton>
      </Tooltip>
      <button
        onClick={onReset}
        className="min-w-12 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Tooltip content="Zoom In (+)">
        <IconButton size="sm" onClick={onZoomIn}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </IconButton>
      </Tooltip>
    </div>
  );
};
