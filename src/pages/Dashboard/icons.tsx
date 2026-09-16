type IconProps = {
  className?: string;
};

const commonProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ProgressBoardIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <line x1="6" y1="20" x2="6" y2="15" />
      <line x1="12" y1="20" x2="12" y2="9" />
      <line x1="18" y1="20" x2="18" y2="4" />
    </svg>
  );
}

export function TasksIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M3.5 6.5 5 8l2.5-2.5" />
      <path d="M3.5 12.5 5 14l2.5-2.5" />
      <path d="M3.5 18.5 5 20l2.5-2.5" />
      <line x1="11" y1="7" x2="20" y2="7" />
      <line x1="11" y1="13" x2="20" y2="13" />
      <line x1="11" y1="19" x2="20" y2="19" />
    </svg>
  );
}

export function OnHoldIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <line x1="9.5" y1="9" x2="9.5" y2="15" />
      <line x1="14.5" y1="9" x2="14.5" y2="15" />
    </svg>
  );
}

export function CrmIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

export function AdminAccessIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
