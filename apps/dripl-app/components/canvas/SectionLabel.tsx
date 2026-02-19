"use client";

interface SectionLabelProps {
  children: React.ReactNode;
}

export const SectionLabel: React.FC<SectionLabelProps> = ({ children }) => (
  <div className="text-[11px] font-medium text-gray-400 mb-2 mt-4 select-none">
    {children}
  </div>
);
