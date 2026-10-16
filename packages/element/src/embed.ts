/**
 * Vector globe glyph for embed placeholders, shared by the static bitmap
 * renderer and the interactive draft renderer. An emoji (`🌐`) renders
 * differently per platform and is missing entirely in some headless export
 * environments, so the placeholder is drawn: circle, meridian, equator.
 */
export function drawGlobeGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  lineWidth = 1.5
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * 0.45, radius, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.stroke();
  ctx.restore();
}
