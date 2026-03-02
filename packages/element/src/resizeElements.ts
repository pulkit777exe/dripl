import type { DriplElement, Point } from "@dripl/common";

export type TransformHandleDirection =
  | "n"
  | "e"
  | "s"
  | "w"
  | "ne"
  | "se"
  | "sw"
  | "nw";

const MIN_WIDTH_OR_HEIGHT = 1;

export const getResizedOrigin = (
  prevOrigin: Point,
  prevWidth: number,
  prevHeight: number,
  newWidth: number,
  newHeight: number,
  angle: number,
  handleDirection: TransformHandleDirection,
  shouldMaintainAspectRatio: boolean,
  shouldResizeFromCenter: boolean,
): Point => {
  const anchor = getResizeAnchor(
    handleDirection,
    shouldMaintainAspectRatio,
    shouldResizeFromCenter,
  );

  const [x, y] = [prevOrigin.x, prevOrigin.y];

  switch (anchor) {
    case "top-left":
      return {
        x:
          x +
          (prevWidth - newWidth) / 2 +
          ((newWidth - prevWidth) / 2) * Math.cos(angle) +
          ((prevHeight - newHeight) / 2) * Math.sin(angle),
        y:
          y +
          (prevHeight - newHeight) / 2 +
          ((newWidth - prevWidth) / 2) * Math.sin(angle) +
          ((newHeight - prevHeight) / 2) * Math.cos(angle),
      };
    case "top-right":
      return {
        x:
          x +
          ((prevWidth - newWidth) / 2) * (Math.cos(angle) + 1) +
          ((prevHeight - newHeight) / 2) * Math.sin(angle),
        y:
          y +
          (prevHeight - newHeight) / 2 +
          ((prevWidth - newWidth) / 2) * Math.sin(angle) +
          ((newHeight - prevHeight) / 2) * Math.cos(angle),
      };
    case "bottom-left":
      return {
        x:
          x +
          ((prevWidth - newWidth) / 2) * (1 - Math.cos(angle)) +
          ((newHeight - prevHeight) / 2) * Math.sin(angle),
        y:
          y +
          ((prevHeight - newHeight) / 2) * (Math.cos(angle) + 1) +
          ((prevWidth - newWidth) / 2) * Math.sin(angle),
      };
    case "bottom-right":
      return {
        x:
          x +
          ((prevWidth - newWidth) / 2) * (Math.cos(angle) + 1) +
          ((newHeight - prevHeight) / 2) * Math.sin(angle),
        y:
          y +
          ((prevHeight - newHeight) / 2) * (Math.cos(angle) + 1) +
          ((prevWidth - newWidth) / 2) * Math.sin(angle),
      };
    case "center":
      return {
        x: x - (newWidth - prevWidth) / 2,
        y: y - (newHeight - prevHeight) / 2,
      };
    case "east-side":
      return {
        x: x + ((prevWidth - newWidth) / 2) * (Math.cos(angle) + 1),
        y:
          y +
          ((prevWidth - newWidth) / 2) * Math.sin(angle) +
          (prevHeight - newHeight) / 2,
      };
    case "west-side":
      return {
        x: x + ((prevWidth - newWidth) / 2) * (1 - Math.cos(angle)),
        y:
          y +
          ((newWidth - prevWidth) / 2) * Math.sin(angle) +
          (prevHeight - newHeight) / 2,
      };
    case "north-side":
      return {
        x:
          x +
          (prevWidth - newWidth) / 2 +
          ((prevHeight - newHeight) / 2) * Math.sin(angle),
        y: y + ((newHeight - prevHeight) / 2) * (Math.cos(angle) - 1),
      };
    case "south-side":
      return {
        x:
          x +
          (prevWidth - newWidth) / 2 +
          ((newHeight - prevHeight) / 2) * Math.sin(angle),
        y: y + ((prevHeight - newHeight) / 2) * (Math.cos(angle) + 1),
      };
    default:
      return prevOrigin;
  }
};

const getResizeAnchor = (
  handleDirection: TransformHandleDirection,
  shouldMaintainAspectRatio: boolean,
  shouldResizeFromCenter: boolean,
): string => {
  if (shouldResizeFromCenter) {
    return "center";
  }

  if (shouldMaintainAspectRatio) {
    if (handleDirection.includes("n") && handleDirection.includes("e"))
      return "top-right";
    if (handleDirection.includes("n") && handleDirection.includes("w"))
      return "top-left";
    if (handleDirection.includes("s") && handleDirection.includes("e"))
      return "bottom-right";
    if (handleDirection.includes("s") && handleDirection.includes("w"))
      return "bottom-left";
  }

  if (handleDirection.includes("n") && handleDirection.includes("e"))
    return "top-right";
  if (handleDirection.includes("n") && handleDirection.includes("w"))
    return "top-left";
  if (handleDirection.includes("s") && handleDirection.includes("e"))
    return "bottom-right";
  if (handleDirection.includes("s") && handleDirection.includes("w"))
    return "bottom-left";
  if (handleDirection.includes("n")) return "north-side";
  if (handleDirection.includes("s")) return "south-side";
  if (handleDirection.includes("e")) return "east-side";
  if (handleDirection.includes("w")) return "west-side";

  return "center";
};

const measureFontSizeFromWidth = (
  element: any,
  metricsWidth: number,
): { size: number; height: number } => {
  const maxFontSize = 200;
  const minFontSize = 8;

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    ctx.font = `${fontSize}px ${element.fontFamily || "Arial"}`;
    const metrics = ctx.measureText(element.text || "A");
    
    if (metrics.width <= metricsWidth) {
      return {
        size: fontSize,
        height: fontSize * (element.lineHeight || 1.2),
      };
    }
  }

  return {
    size: minFontSize,
    height: minFontSize * (element.lineHeight || 1.2),
  };
};

const getMinTextElementWidth = (fontString: string, lineHeight: number): number => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 20;

  ctx.font = fontString;
  const metrics = ctx.measureText("A");
  return metrics.width + 8;
};

const wrapText = (
  text: string,
  fontString: string,
  maxWidth: number,
): string => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text;

  ctx.font = fontString;
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = (words[0] || "") as string;

  for (let i = 1; i < words.length; i++) {
    const word = (words[i] || "") as string;
    const testLine = `${currentLine} ${word}`;
    const metrics = ctx.measureText(testLine);

    if (metrics.width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n");
};

const measureText = (
  text: string,
  fontString: string,
  lineHeight: number,
): { width: number; height: number } => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: 0, height: 0 };

  ctx.font = fontString;
  const lines = text.split("\n");
  let maxWidth = 0;

  lines.forEach((line) => {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxWidth) {
      maxWidth = metrics.width;
    }
  });

  return {
    width: maxWidth,
    height: lines.length * lineHeight,
  };
};

export const resizeSingleTextElement = (
  origElement: DriplElement,
  element: DriplElement,
  handleDirection: TransformHandleDirection,
  shouldResizeFromCenter: boolean,
  nextWidth: number,
  nextHeight: number,
): Partial<DriplElement> => {
  if (element.type !== "text") return {};

  if (handleDirection.includes("n") || handleDirection.includes("s")) {
    const metricsWidth = origElement.width * (nextHeight / origElement.height);
    const metrics = measureFontSizeFromWidth(element, metricsWidth);

    const previousOrigin = { x: origElement.x, y: origElement.y };
    const newOrigin = getResizedOrigin(
      previousOrigin,
      origElement.width,
      origElement.height,
      metricsWidth,
      nextHeight,
      origElement.angle || 0,
      handleDirection,
      false,
      shouldResizeFromCenter,
    );

    return {
      fontSize: metrics.size,
      width: metricsWidth,
      height: nextHeight,
      x: newOrigin.x,
      y: newOrigin.y,
    };
  }

  if (handleDirection === "e" || handleDirection === "w") {
    const minWidth = getMinTextElementWidth(
      `${element.fontSize || 16}px ${element.fontFamily || "Arial"}`,
      element.lineHeight || 1.2,
    );

    const newWidth = Math.max(minWidth, nextWidth);
    const text = wrapText(
      element.text || "",
      `${element.fontSize || 16}px ${element.fontFamily || "Arial"}`,
      Math.abs(newWidth),
    );
    const metrics = measureText(
      text,
      `${element.fontSize || 16}px ${element.fontFamily || "Arial"}`,
      element.lineHeight || 1.2,
    );

    const newHeight = metrics.height;
    const previousOrigin = { x: origElement.x, y: origElement.y };
    const newOrigin = getResizedOrigin(
      previousOrigin,
      origElement.width,
      origElement.height,
      newWidth,
      newHeight,
      element.angle || 0,
      handleDirection,
      false,
      shouldResizeFromCenter,
    );

    return {
      width: Math.abs(newWidth),
      height: Math.abs(metrics.height),
      x: newOrigin.x,
      y: newOrigin.y,
      text,
      autoResize: false,
    };
  }

  return {};
};

export const resizeSingleLinearElement = (
  origElement: DriplElement,
  element: DriplElement,
  handleDirection: TransformHandleDirection,
  shouldResizeFromCenter: boolean,
  nextWidth: number,
  nextHeight: number,
): Partial<DriplElement> => {
  if (!("points" in element) || !element.points) return {};

  const prevWidth = origElement.width;
  const prevHeight = origElement.height;
  const scaleX = prevWidth === 0 ? 1 : nextWidth / prevWidth;
  const scaleY = prevHeight === 0 ? 1 : nextHeight / prevHeight;

  const previousOrigin = { x: origElement.x, y: origElement.y };
  const newOrigin = getResizedOrigin(
    previousOrigin,
    prevWidth,
    prevHeight,
    nextWidth,
    nextHeight,
    element.angle || 0,
    handleDirection,
    false,
    shouldResizeFromCenter,
  );

  return {
    x: newOrigin.x,
    y: newOrigin.y,
    width: nextWidth,
    height: nextHeight,
    points: element.points.map((p: Point) => ({
      x: (p.x - previousOrigin.x + newOrigin.x) * scaleX,
      y: (p.y - previousOrigin.y + newOrigin.y) * scaleY,
    })),
  };
};

export const resizeSingleFreeDrawElement = (
  origElement: DriplElement,
  element: DriplElement,
  handleDirection: TransformHandleDirection,
  shouldResizeFromCenter: boolean,
  nextWidth: number,
  nextHeight: number,
): Partial<DriplElement> => {
  if (!("points" in element) || !element.points) return {};

  const prevWidth = origElement.width;
  const prevHeight = origElement.height;
  const scaleX = prevWidth === 0 ? 1 : nextWidth / prevWidth;
  const scaleY = prevHeight === 0 ? 1 : nextHeight / prevHeight;

  const previousOrigin = { x: origElement.x, y: origElement.y };
  const newOrigin = getResizedOrigin(
    previousOrigin,
    prevWidth,
    prevHeight,
    nextWidth,
    nextHeight,
    element.angle || 0,
    handleDirection,
    false,
    shouldResizeFromCenter,
  );

  return {
    x: newOrigin.x,
    y: newOrigin.y,
    width: nextWidth,
    height: nextHeight,
    points: element.points.map((p: Point) => ({
      x: (p.x - previousOrigin.x + newOrigin.x) * scaleX,
      y: (p.y - previousOrigin.y + newOrigin.y) * scaleY,
    })),
  };
};

export const resizeSingleElement = (
  nextWidth: number,
  nextHeight: number,
  latestElement: DriplElement,
  origElement: DriplElement,
  handleDirection: TransformHandleDirection,
  {
    shouldMaintainAspectRatio = false,
    shouldResizeFromCenter = false,
  }: {
    shouldMaintainAspectRatio?: boolean;
    shouldResizeFromCenter?: boolean;
  } = {},
): Partial<DriplElement> => {
  const newWidth = Math.max(MIN_WIDTH_OR_HEIGHT, nextWidth);
  const newHeight = Math.max(MIN_WIDTH_OR_HEIGHT, nextHeight);

  if (latestElement.type === "text") {
    return resizeSingleTextElement(
      origElement,
      latestElement,
      handleDirection,
      shouldResizeFromCenter,
      newWidth,
      newHeight,
    );
  }

  if (latestElement.type === "arrow" || latestElement.type === "line") {
    return resizeSingleLinearElement(
      origElement,
      latestElement,
      handleDirection,
      shouldResizeFromCenter,
      newWidth,
      newHeight,
    );
  }

  if (latestElement.type === "freedraw") {
    return resizeSingleFreeDrawElement(
      origElement,
      latestElement,
      handleDirection,
      shouldResizeFromCenter,
      newWidth,
      newHeight,
    );
  }

  const previousOrigin = { x: origElement.x, y: origElement.y };
  const newOrigin = getResizedOrigin(
    previousOrigin,
    origElement.width,
    origElement.height,
    newWidth,
    newHeight,
    origElement.angle || 0,
    handleDirection,
    shouldMaintainAspectRatio,
    shouldResizeFromCenter,
  );

  return {
    x: newOrigin.x,
    y: newOrigin.y,
    width: newWidth,
    height: newHeight,
  };
};
