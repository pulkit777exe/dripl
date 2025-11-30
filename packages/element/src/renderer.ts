import { DriplElement } from '@dripl/common';

export const renderElement = (
  ctx: CanvasRenderingContext2D,
  element: DriplElement
) => {
  ctx.save();
  ctx.globalAlpha = element.opacity;
  ctx.strokeStyle = element.strokeColor;
  ctx.fillStyle = element.backgroundColor;
  ctx.lineWidth = element.strokeWidth;

  switch (element.type) {
    case 'rectangle':
      ctx.fillRect(element.x, element.y, element.width, element.height);
      ctx.strokeRect(element.x, element.y, element.width, element.height);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        element.x + element.width / 2,
        element.y + element.height / 2,
        element.width / 2,
        element.height / 2,
        0,
        0,
        2 * Math.PI
      );
      ctx.fill();
      ctx.stroke();
      break;
    // TODO: Implement other shapes
  }
  ctx.restore();
};
