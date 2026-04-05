import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SectionLabel } from "@/components/canvas/SectionLabel";

describe("SectionLabel", () => {
  it("renders children correctly", () => {
    render(<SectionLabel>Test Label</SectionLabel>);
    expect(screen.getByText("Test Label")).toBeInTheDocument();
  });

  it("applies correct styling classes", () => {
    render(<SectionLabel>Styled Label</SectionLabel>);
    const label = screen.getByText("Styled Label");
    expect(label).toHaveClass("text-[11px]", "font-medium", "text-gray-400");
  });

  it("renders complex children", () => {
    render(
      <SectionLabel>
        <span className="custom">Complex Content</span>
      </SectionLabel>,
    );
    expect(screen.getByText("Complex Content")).toBeInTheDocument();
  });
});
