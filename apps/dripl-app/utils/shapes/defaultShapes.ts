import type { ShapeDefinition, DriplElement, Point, ElementBase } from "@dripl/common";
import { createRectangleElement, RectangleToolState } from "@/utils/tools/rectangle";
import { createEllipseElement, EllipseToolState } from "@/utils/tools/ellipse";
import { createDiamondElement, DiamondToolState } from "@/utils/tools/diamond";
import { createArrowElement, ArrowToolState } from "@/utils/tools/arrow";
import { createLineElement, LineToolState } from "@/utils/tools/line";
import { createFreedrawElement, FreedrawToolState } from "@/utils/tools/freedraw";
import { createTextElement, TextToolState } from "@/utils/tools/text";
import { createImageElement, ImageToolState } from "@/utils/tools/image";
import { createFrameElement, FrameToolState } from "@/utils/tools/frame";

// Rectangle shape definition
export const rectangleShape: ShapeDefinition = {
  type: "rectangle",
  name: "Rectangle",
  icon: "square",
  category: "basic",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "rectangle" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "rectangle" && 
           typeof element.x === "number" && 
           typeof element.y === "number" && 
           typeof element.width === "number" && 
           typeof element.height === "number";
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    
    if (element.backgroundColor && element.backgroundColor !== "transparent") {
      ctx.fillStyle = element.backgroundColor;
      ctx.fillRect(element.x, element.y, element.width, element.height);
    }
    
    ctx.strokeRect(element.x, element.y, element.width, element.height);
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const ellipseShape: ShapeDefinition = {
  type: "ellipse",
  name: "Ellipse",
  icon: "circle",
  category: "basic",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "ellipse" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "ellipse" && 
           typeof element.x === "number" && 
           typeof element.y === "number" && 
           typeof element.width === "number" && 
           typeof element.height === "number";
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    
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
    
    if (element.backgroundColor && element.backgroundColor !== "transparent") {
      ctx.fillStyle = element.backgroundColor;
      ctx.fill();
    }
    
    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const diamondShape: ShapeDefinition = {
  type: "diamond",
  name: "Diamond",
  icon: "diamond",
  category: "basic",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "diamond" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "diamond" && 
           typeof element.x === "number" && 
           typeof element.y === "number" && 
           typeof element.width === "number" && 
           typeof element.height === "number";
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const halfWidth = element.width / 2;
    const halfHeight = element.height / 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX, element.y);
    ctx.lineTo(element.x + element.width, centerY);
    ctx.lineTo(centerX, element.y + element.height);
    ctx.lineTo(element.x, centerY);
    ctx.closePath();
    
    if (element.backgroundColor && element.backgroundColor !== "transparent") {
      ctx.fillStyle = element.backgroundColor;
      ctx.fill();
    }
    
    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const arrowShape: ShapeDefinition = {
  type: "arrow",
  name: "Arrow",
  icon: "arrow-right",
  category: "connectors",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "arrow" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "arrow" && 
           Array.isArray(element.points) && 
           element.points.length >= 2;
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const arrowElement = element as any;
    if (!arrowElement.points || arrowElement.points.length < 2) return;
    
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    
    ctx.beginPath();
    ctx.moveTo(arrowElement.points[0].x, arrowElement.points[0].y);
    ctx.lineTo(arrowElement.points[1].x, arrowElement.points[1].y);
    ctx.stroke();
    
    const dx = arrowElement.points[1].x - arrowElement.points[0].x;
    const dy = arrowElement.points[1].y - arrowElement.points[0].y;
    const angle = Math.atan2(dy, dx);
    const headLength = 10;
    
    ctx.beginPath();
    ctx.moveTo(arrowElement.points[1].x, arrowElement.points[1].y);
    ctx.lineTo(
      arrowElement.points[1].x - headLength * Math.cos(angle - Math.PI / 6),
      arrowElement.points[1].y - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      arrowElement.points[1].x - headLength * Math.cos(angle + Math.PI / 6),
      arrowElement.points[1].y - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const lineShape: ShapeDefinition = {
  type: "line",
  name: "Line",
  icon: "minus",
  category: "connectors",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "line" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "line" && 
           Array.isArray(element.points) && 
           element.points.length >= 2;
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const lineElement = element as any;
    if (!lineElement.points || lineElement.points.length < 2) return;
    
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    
    ctx.beginPath();
    ctx.moveTo(lineElement.points[0].x, lineElement.points[0].y);
    ctx.lineTo(lineElement.points[1].x, lineElement.points[1].y);
    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const textShape: ShapeDefinition = {
  type: "text",
  name: "Text",
  icon: "type",
  category: "text",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "text" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    text: "Text",
    fontSize: 16,
    fontFamily: "Arial",
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "text" && 
           typeof element.text === "string";
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const textElement = element as any;
    
    ctx.fillStyle = element.strokeColor || "#000000";
    ctx.font = `${textElement.fontSize}px ${textElement.fontFamily}`;
    ctx.globalAlpha = element.opacity || 1;
    
    ctx.fillText(textElement.text, element.x, element.y + textElement.fontSize);
  },
  getProperties: (element: DriplElement) => {
    const textElement = element as any;
    return {
      strokeColor: element.strokeColor,
      text: textElement.text,
      fontSize: textElement.fontSize,
      fontFamily: textElement.fontFamily,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const imageShape: ShapeDefinition = {
  type: "image",
  name: "Image",
  icon: "image",
  category: "media",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "image" as const,
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    src: "",
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "image" && 
           typeof element.src === "string";
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const imageElement = element as any;
    if (!imageElement.src) return;
    
    ctx.globalAlpha = element.opacity || 1;
    
    const img = new Image();
    img.src = imageElement.src;
    img.onload = () => {
      ctx.drawImage(img, element.x, element.y, element.width, element.height);
    };
  },
  getProperties: (element: DriplElement) => {
    const imageElement = element as any;
    return {
      src: imageElement.src,
      opacity: element.opacity,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const frameShape: ShapeDefinition = {
  type: "frame",
  name: "Frame",
  icon: "square",
  category: "containers",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "frame" as const,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    title: "Frame",
    padding: 20,
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "frame" && 
           typeof element.x === "number" && 
           typeof element.y === "number" && 
           typeof element.width === "number" && 
           typeof element.height === "number";
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const frameElement = element as any;
    
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    
    ctx.strokeRect(element.x, element.y, element.width, element.height);
    
    const padding = frameElement.padding || 20;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      element.x + padding,
      element.y + padding,
      element.width - 2 * padding,
      element.height - 2 * padding
    );
    ctx.setLineDash([]);
    
    if (frameElement.title) {
      ctx.fillStyle = element.strokeColor || "#000000";
      ctx.font = "14px Arial";
      ctx.fillText(
        frameElement.title,
        element.x + 10,
        element.y - 10
      );
    }
  },
  getProperties: (element: DriplElement) => {
    const frameElement = element as any;
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
      title: frameElement.title,
      padding: frameElement.padding,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const freedrawShape: ShapeDefinition = {
  type: "freedraw",
  name: "Freedraw",
  icon: "pen",
  category: "drawing",
  create: (props: Partial<DriplElement>) => ({
    id: crypto.randomUUID(),
    type: "freedraw" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    points: [],
    ...props,
  } as DriplElement),
  validate: (element: any) => {
    return element && 
           element.type === "freedraw" && 
           Array.isArray(element.points);
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const freedrawElement = element as any;
    if (!freedrawElement.points || freedrawElement.points.length < 2) return;
    
    ctx.strokeStyle = element.strokeColor || "#000000";
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    
    ctx.beginPath();
    ctx.moveTo(freedrawElement.points[0].x, freedrawElement.points[0].y);
    for (let i = 1; i < freedrawElement.points.length; i++) {
      ctx.lineTo(freedrawElement.points[i].x, freedrawElement.points[i].y);
    }
    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
    };
  },
  setProperties: (element: DriplElement, properties: any) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const defaultShapes = [
  rectangleShape,
  ellipseShape,
  diamondShape,
  arrowShape,
  lineShape,
  textShape,
  imageShape,
  freedrawShape,
];