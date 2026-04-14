'use client';

import { HelpCircle, X, BookOpen, ExternalLink, Github, Youtube, Keyboard } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

interface ShortcutItemProps {
  toolName: string;
  shortcut: string;
}

function ShortcutItem({ toolName, shortcut }: ShortcutItemProps) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[#E4E0D9] last:border-b-0">
      <div className="text-[13px] text-[#6B6860] flex-1">{toolName}</div>
      <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#E8E5DE] text-[#6B6860] border border-[#D4D0C9] min-w-[48px] text-center">
        {shortcut}
      </div>
    </div>
  );
}

interface HeaderButtonProps {
  icon: React.ReactNode;
  label: string;
}

function HeaderButton({ icon, label }: HeaderButtonProps) {
  return (
    <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#E8E5DE] rounded-md text-[12px] text-[#6B6860] border border-[#D4D0C9] transition-colors">
      {icon}
      {label}
    </button>
  );
}

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-100 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#FAFAF7] rounded-xl border border-[#E4E0D9] shadow-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-3.5 border-b border-[#E4E0D9]">
          <h2 className="text-[15px] font-semibold text-[#1A1917] flex items-center gap-2">
            <HelpCircle size={18} className="text-[#E8462A]" />
            Help
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[#9B9890] hover:text-[#1A1917] hover:bg-[#E8E5DE] rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 flex gap-2 border-b border-[#E4E0D9] flex-wrap">
          <HeaderButton icon={<BookOpen size={14} />} label="Documentation" />
          <HeaderButton icon={<ExternalLink size={14} />} label="Blog" />
          <HeaderButton icon={<Github size={14} />} label="GitHub" />
          <HeaderButton icon={<Youtube size={14} />} label="YouTube" />
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <h3 className="text-[14px] font-semibold text-[#1A1917] mb-3 flex items-center gap-2">
            <Keyboard size={16} className="text-[#6B6860]" />
            Keyboard shortcuts
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-0 text-sm">
            <div>
              <h4 className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider mb-2 mt-3">Tools</h4>
              <ShortcutItem toolName="Hand (panning tool)" shortcut="H" />
              <ShortcutItem toolName="Selection" shortcut="V or 1" />
              <ShortcutItem toolName="Rectangle" shortcut="R or 2" />
              <ShortcutItem toolName="Diamond" shortcut="3" />
              <ShortcutItem toolName="Draw (freehand)" shortcut="D or P or 7" />
              <ShortcutItem toolName="Ellipse" shortcut="O or 4" />
              <ShortcutItem toolName="Arrow" shortcut="A or 5" />
              <ShortcutItem toolName="Line" shortcut="L or 6" />
              <ShortcutItem toolName="Text" shortcut="T or 8" />
              <ShortcutItem toolName="Insert image" shortcut="9" />
              <ShortcutItem toolName="Eraser" shortcut="X or 0" />
              <ShortcutItem toolName="Frame" shortcut="F" />
            </div>

            <div>
              <h4 className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider mb-2 mt-3">Editor</h4>
              <ShortcutItem toolName="Move canvas" shortcut="Space + Drag" />
              <ShortcutItem toolName="Delete" shortcut="Delete" />
              <ShortcutItem toolName="Cut" shortcut="Ctrl+X" />
              <ShortcutItem toolName="Copy" shortcut="Ctrl+C" />
              <ShortcutItem toolName="Paste" shortcut="Ctrl+V" />
              <ShortcutItem toolName="Select all" shortcut="Ctrl+A" />
              <ShortcutItem toolName="Undo" shortcut="Ctrl+Z" />
              <ShortcutItem toolName="Redo" shortcut="Ctrl+Shift+Z" />
              <ShortcutItem toolName="Zoom in" shortcut="Ctrl + +" />
              <ShortcutItem toolName="Zoom out" shortcut="Ctrl + -" />
              <ShortcutItem toolName="Reset zoom" shortcut="Ctrl+0" />
              <ShortcutItem toolName="Toggle grid" shortcut="Ctrl+G" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
