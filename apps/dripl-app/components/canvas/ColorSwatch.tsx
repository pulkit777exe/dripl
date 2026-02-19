"use client";

interface ColorSwatchProps {
  color: string;
  isSelected?: boolean;
  onClick?: () => void;
}

export const ColorSwatch: React.FC<ColorSwatchProps> = ({
  color,
  isSelected,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={`w-7 h-7 rounded-md border-2 transition-all relative ${
      isSelected
        ? "border-[#a8a5ff] shadow-sm shadow-[#a8a5ff]/30"
        : "border-gray-600 hover:border-gray-400"
    }`}
    style={{ backgroundColor: color === "transparent" ? "transparent" : color }}
  >
    {color === "transparent" && (
      <div
        className="absolute inset-0.5 rounded-sm opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(45deg, var(--color-panel-slider) 25%, transparent 25%, transparent 75%, var(--color-panel-slider) 75%, var(--color-panel-slider)), linear-gradient(45deg, var(--color-panel-slider) 25%, transparent 25%, transparent 75%, var(--color-panel-slider) 75%, var(--color-panel-slider))",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0, 4px 4px",
        }}
      />
    )}
    {isSelected && (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-2 h-2 bg-white rounded-full shadow-lg"></div>
      </div>
    )}
  </button>
);
