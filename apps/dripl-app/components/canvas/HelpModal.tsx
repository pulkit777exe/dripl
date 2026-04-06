"use client";

import {
  HelpCircle,
  X,
  BookOpen,
  ExternalLink,
  Github,
  Youtube,
  Keyboard,
} from "lucide-react";

interface HelpModalProps {
  onClose: () => void;
}

interface ShortcutItemProps {
  toolName: string;
  shortcut: string;
}

function ShortcutItem({ toolName, shortcut }: ShortcutItemProps) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-(--color-panel-slider)/50 last:border-b-0">
      <div className="text-(--color-tool-inactive-text) flex-1">{toolName}</div>
      <div className="text-xs font-mono px-3 py-0.5 rounded-md bg-(--color-tool-hover-bg) text-(--color-tool-inactive-text) border border-(--color-panel-slider)/50 min-w-[50px] text-center">
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
    <button className="flex items-center gap-2 px-3 py-2 bg-(--color-panel-btn-bg) hover:bg-(--color-tool-hover-bg) rounded-lg text-sm text-(--color-tool-inactive-text) border border-(--color-panel-slider)/50 transition-colors">
      {icon}
      {label}
    </button>
  );
}

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-100 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-(--color-panel-bg) rounded-xl border border-(--color-panel-slider) shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b border-(--color-panel-slider)/50">
          <h2 className="text-xl font-semibold text-(--color-panel-text) flex items-center gap-3">
            <HelpCircle size={24} className="text-(--color-tool-active-text)" />
            Help
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-(--color-tool-inactive-text) hover:bg-(--color-tool-hover-bg) rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-5 flex gap-3 border-b border-panel-slider flex-wrap">
          <HeaderButton icon={<BookOpen size={18} />} label="Documentation" />
          <HeaderButton icon={<ExternalLink size={18} />} label="Blog" />
          <HeaderButton icon={<Github size={18} />} label="GitHub" />
          <HeaderButton icon={<Youtube size={18} />} label="YouTube" />
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <h3 className="text-lg font-semibold text-panel-text mb-4 flex items-center gap-2">
            <Keyboard size={20} className="text-tool-inactive-text" />
            Keyboard shortcuts
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-0 text-sm">
            <div>
              <h4 className="text-xs font-bold text-panel-label uppercase mb-2 mt-4">
                Tools
              </h4>
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
              <h4 className="text-xs font-bold text-panel-label uppercase mb-2 mt-4">
                Editor
              </h4>
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
