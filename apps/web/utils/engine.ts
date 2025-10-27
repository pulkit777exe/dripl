type Shapes = "rectangle" | "circle" | "line";
type FillColor = "red" | "blue" | "green" | "yellow" | "none";
type Tool = "select" | "pan" | "draw";

interface Point {
  x: number;
  y: number;
}

interface DrawnShape {
  id: string;
  type: Shapes;
  color: FillColor;
  startPoint: Point;
  endPoint: Point;
  userId: string;
  timestamp: number;
}

interface EngineState {
  shapes: DrawnShape[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}

interface WebSocketMessage {
  type: "shape_added" | "shape_removed" | "shape_updated" | "state_sync" | "cursor_move";
  data: any;
  userId: string;
  roomId: string;
}

export class CollaborativeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentShape: Shapes;
  private currentColor: FillColor;
  private currentTool: Tool = "draw";
  private isDrawing: boolean = false;
  private isPanning: boolean = false;
  private startPoint: Point | null = null;
  private shapes: Map<string, DrawnShape> = new Map();
  private currentDragShape: DrawnShape | null = null;
  private selectedShapeId: string | null = null;
  
  private viewport = { x: 0, y: 0, zoom: 1 };
  private lastPanPoint: Point | null = null;
  
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private userId: string;
  private roomId: string;
  private remoteCursors: Map<string, Point> = new Map();
  private isDestroyed: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  
  // Bound event handlers to maintain references for removal
  private boundHandlers: {
    mouseDown: (e: MouseEvent) => void;
    mouseMove: (e: MouseEvent) => void;
    mouseUp: (e: MouseEvent) => void;
    wheel: (e: WheelEvent) => void;
  };

  // Performance optimization
  private lastCursorBroadcast: number = 0;
  private cursorBroadcastThrottle: number = 50; // ms
  private animationFrameId: number | null = null;
  private needsRedraw: boolean = false;
  private readOnly: boolean = false;

  constructor(
    canvas: HTMLCanvasElement,
    userId: string,
    roomId: string,
    wsUrl: string,
    shape: Shapes = "rectangle",
    color: FillColor = "none",
    readOnly: boolean = false
  ) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get 2D context from canvas");
    }
    this.ctx = context;
    this.currentShape = shape;
    this.currentColor = color;
    this.userId = userId;
    this.roomId = roomId;
    this.wsUrl = wsUrl;
    this.readOnly = readOnly;

    // Bind handlers once for proper cleanup
    this.boundHandlers = {
      mouseDown: this.handleMouseDown.bind(this),
      mouseMove: this.handleMouseMove.bind(this),
      mouseUp: this.handleMouseUp.bind(this),
      wheel: this.handleWheel.bind(this)
    };

    this.initializeEventListeners();
    this.connectWebSocket(wsUrl);
    this.startRenderLoop();
  }

  private startRenderLoop(): void {
    const render = () => {
      if (this.isDestroyed) return;
      
      if (this.needsRedraw) {
        this.redraw();
        this.needsRedraw = false;
      }
      
      this.animationFrameId = requestAnimationFrame(render);
    };
    
    render();
  }

  public scheduleRedraw(): void {
    this.needsRedraw = true;
  }

  private connectWebSocket(wsUrl: string): void {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log("WebSocket connected");
        this.reconnectAttempts = 0;
        
        this.ws?.send(JSON.stringify({
          type: "join_room",
          roomId: this.roomId,
          userId: this.userId
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected");
        this.attemptReconnect();
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimeout = setTimeout(() => {
      if (!this.isDestroyed) {
        this.connectWebSocket(this.wsUrl);
      }
    }, delay);
  }

  private handleWebSocketMessage(message: WebSocketMessage): void {
    if (message.userId === this.userId) return;

    switch (message.type) {
      case "shape_added":
        this.shapes.set(message.data.id, message.data);
        this.scheduleRedraw();
        break;
      case "shape_removed":
        this.shapes.delete(message.data.id);
        this.scheduleRedraw();
        break;
      case "shape_updated":
        this.shapes.set(message.data.id, message.data);
        this.scheduleRedraw();
        break;
      case "state_sync":
        this.shapes.clear();
        message.data.shapes.forEach((shape: DrawnShape) => {
          this.shapes.set(shape.id, shape);
        });
        if (message.data.viewport) {
          this.viewport = message.data.viewport;
        }
        this.scheduleRedraw();
        break;
      case "cursor_move":
        this.remoteCursors.set(message.userId, message.data);
        this.scheduleRedraw();
        break;
    }
  }

  private broadcastMessage(type: string, data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected, message not sent:", type);
      return;
    }

    try {
      this.ws.send(JSON.stringify({
        type,
        data,
        userId: this.userId,
        roomId: this.roomId
      }));
    } catch (error) {
      console.error("Failed to send WebSocket message:", error);
    }
  }

  private initializeEventListeners(): void {
    this.canvas.addEventListener("mousedown", this.boundHandlers.mouseDown);
    this.canvas.addEventListener("mousemove", this.boundHandlers.mouseMove);
    this.canvas.addEventListener("mouseup", this.boundHandlers.mouseUp);
    this.canvas.addEventListener("mouseleave", this.boundHandlers.mouseUp);
    this.canvas.addEventListener("wheel", this.boundHandlers.wheel, { passive: false });
  }

  private getMousePos(event: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - this.viewport.x) / this.viewport.zoom;
    const y = (event.clientY - rect.top - this.viewport.y) / this.viewport.zoom;
    return { x, y };
  }

  private handleMouseDown(event: MouseEvent): void {
    event.preventDefault();
    
    if (this.readOnly) return; // Disable drawing in read-only mode
    
    const point = this.getMousePos(event);

    if (this.currentTool === "pan" || event.button === 1) {
      this.isPanning = true;
      this.lastPanPoint = { x: event.clientX, y: event.clientY };
      this.canvas.style.cursor = "grabbing";
      return;
    }

    if (this.currentTool === "select") {
      this.selectedShapeId = this.findShapeAtPoint(point);
      this.scheduleRedraw();
      return;
    }

    if (this.currentTool === "draw") {
      this.isDrawing = true;
      this.startPoint = point;
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    const point = this.getMousePos(event);

    // Throttle cursor broadcasts (always allow in read-only mode for viewing)
    const now = Date.now();
    if (now - this.lastCursorBroadcast > this.cursorBroadcastThrottle) {
      this.broadcastMessage("cursor_move", point);
      this.lastCursorBroadcast = now;
    }

    if (this.isPanning && this.lastPanPoint) {
      const dx = event.clientX - this.lastPanPoint.x;
      const dy = event.clientY - this.lastPanPoint.y;
      this.viewport.x += dx;
      this.viewport.y += dy;
      this.lastPanPoint = { x: event.clientX, y: event.clientY };
      this.scheduleRedraw();
      return;
    }

    if (this.readOnly || !this.isDrawing || !this.startPoint) return;

    this.currentDragShape = {
      id: `temp-${Date.now()}`,
      type: this.currentShape,
      color: this.currentColor,
      startPoint: this.startPoint,
      endPoint: point,
      userId: this.userId,
      timestamp: Date.now()
    };

    this.scheduleRedraw();
  }

  private handleMouseUp(event: MouseEvent): void {
    if (this.isPanning) {
      this.isPanning = false;
      this.lastPanPoint = null;
      this.updateCursor();
      return;
    }

    if (this.readOnly || !this.isDrawing || !this.startPoint) return;

    const endPoint = this.getMousePos(event);
    
    // Only create shape if there's meaningful distance
    const dx = endPoint.x - this.startPoint.x;
    const dy = endPoint.y - this.startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 5) {
      const shape: DrawnShape = {
        id: `${this.userId}-${Date.now()}`,
        type: this.currentShape,
        color: this.currentColor,
        startPoint: this.startPoint,
        endPoint: endPoint,
        userId: this.userId,
        timestamp: Date.now()
      };

      this.shapes.set(shape.id, shape);
      this.broadcastMessage("shape_added", shape);
    }
    
    this.currentDragShape = null;
    this.isDrawing = false;
    this.startPoint = null;

    this.scheduleRedraw();
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, this.viewport.zoom * zoomFactor));

    this.viewport.x = mouseX - (mouseX - this.viewport.x) * (newZoom / this.viewport.zoom);
    this.viewport.y = mouseY - (mouseY - this.viewport.y) * (newZoom / this.viewport.zoom);
    this.viewport.zoom = newZoom;

    this.scheduleRedraw();
  }

  private findShapeAtPoint(point: Point): string | null {
    const shapesArray = Array.from(this.shapes.values()).reverse();
    for (const shape of shapesArray) {
      if (this.isPointInShape(point, shape)) {
        return shape.id;
      }
    }
    return null;
  }

  private isPointInShape(point: Point, shape: DrawnShape): boolean {
    const { startPoint, endPoint, type } = shape;
    
    if (type === "rectangle") {
      const minX = Math.min(startPoint.x, endPoint.x);
      const maxX = Math.max(startPoint.x, endPoint.x);
      const minY = Math.min(startPoint.y, endPoint.y);
      const maxY = Math.max(startPoint.y, endPoint.y);
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }
    
    if (type === "circle") {
      const radius = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2)
      );
      const distance = Math.sqrt(
        Math.pow(point.x - startPoint.x, 2) + Math.pow(point.y - startPoint.y, 2)
      );
      return distance <= radius;
    }
    
    if (type === "line") {
      // Check if point is near the line (within 5 pixels)
      const lineLength = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2)
      );
      const distance = Math.abs(
        (endPoint.y - startPoint.y) * point.x -
        (endPoint.x - startPoint.x) * point.y +
        endPoint.x * startPoint.y -
        endPoint.y * startPoint.x
      ) / lineLength;
      return distance <= 5;
    }
    
    return false;
  }

  private redraw(): void {
    try {
      this.ctx.save();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.ctx.translate(this.viewport.x, this.viewport.y);
      this.ctx.scale(this.viewport.zoom, this.viewport.zoom);

      this.drawGrid();

      this.shapes.forEach((shape) => {
        this.drawShape(shape, shape.id === this.selectedShapeId);
      });

      if (this.currentDragShape) {
        this.drawShape(this.currentDragShape, false, true);
      }

      this.ctx.restore();

      this.drawRemoteCursors();
    } catch (error) {
      console.error("Error during redraw:", error);
    }
  }

  private drawGrid(): void {
    const gridSize = 50;
    this.ctx.strokeStyle = "#e0e0e0";
    this.ctx.lineWidth = 0.5 / this.viewport.zoom;

    const startX = Math.floor(-this.viewport.x / this.viewport.zoom / gridSize) * gridSize;
    const startY = Math.floor(-this.viewport.y / this.viewport.zoom / gridSize) * gridSize;
    const endX = startX + (this.canvas.width / this.viewport.zoom) + gridSize;
    const endY = startY + (this.canvas.height / this.viewport.zoom) + gridSize;

    for (let x = startX; x < endX; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, startY);
      this.ctx.lineTo(x, endY);
      this.ctx.stroke();
    }

    for (let y = startY; y < endY; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(startX, y);
      this.ctx.lineTo(endX, y);
      this.ctx.stroke();
    }
  }

  private drawShape(shape: DrawnShape, isSelected: boolean = false, isPreview: boolean = false): void {
    const { type, color, startPoint, endPoint } = shape;

    this.ctx.fillStyle = color === "none" ? "transparent" : color;
    this.ctx.strokeStyle = color === "none" ? "#000000" : color;
    this.ctx.lineWidth = 2 / this.viewport.zoom;

    if (isPreview) {
      this.ctx.globalAlpha = 0.5;
    }

    switch (type) {
      case "rectangle":
        this.drawRectangle(startPoint, endPoint, color === "none");
        break;
      case "circle":
        this.drawCircle(startPoint, endPoint, color === "none");
        break;
      case "line":
        this.drawLine(startPoint, endPoint);
        break;
    }

    if (isSelected) {
      this.drawSelectionBox(startPoint, endPoint, type);
    }

    this.ctx.globalAlpha = 1.0;
  }

  private drawRectangle(start: Point, end: Point, strokeOnly: boolean = false): void {
    const width = end.x - start.x;
    const height = end.y - start.y;
    
    if (strokeOnly) {
      this.ctx.strokeRect(start.x, start.y, width, height);
    } else {
      this.ctx.fillRect(start.x, start.y, width, height);
    }
  }

  private drawCircle(start: Point, end: Point, strokeOnly: boolean = false): void {
    const radius = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );
    this.ctx.beginPath();
    this.ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
    
    if (strokeOnly) {
      this.ctx.stroke();
    } else {
      this.ctx.fill();
    }
  }

  private drawLine(start: Point, end: Point): void {
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();
  }

  private drawSelectionBox(start: Point, end: Point, type: Shapes): void {
    this.ctx.strokeStyle = "#0066ff";
    this.ctx.lineWidth = 2 / this.viewport.zoom;
    this.ctx.setLineDash([5 / this.viewport.zoom, 5 / this.viewport.zoom]);
    
    if (type === "circle") {
      const radius = Math.sqrt(
        Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
      );
      this.ctx.beginPath();
      this.ctx.arc(start.x, start.y, radius + 5, 0, 2 * Math.PI);
      this.ctx.stroke();
    } else {
      const width = end.x - start.x;
      const height = end.y - start.y;
      this.ctx.strokeRect(start.x - 5, start.y - 5, width + 10, height + 10);
    }
    
    this.ctx.setLineDash([]);
  }

  private drawRemoteCursors(): void {
    this.remoteCursors.forEach((pos, userId) => {
      const screenX = pos.x * this.viewport.zoom + this.viewport.x;
      const screenY = pos.y * this.viewport.zoom + this.viewport.y;
      
      // Draw cursor pointer
      this.ctx.fillStyle = "#ff0000";
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
      this.ctx.fill();
      
      // Draw user label
      this.ctx.fillStyle = "#ffffff";
      this.ctx.strokeStyle = "#000000";
      this.ctx.lineWidth = 3;
      this.ctx.font = "bold 12px Arial";
      const label = userId.substring(0, 8);
      this.ctx.strokeText(label, screenX + 10, screenY);
      this.ctx.fillText(label, screenX + 10, screenY);
    });
  }

  private updateCursor(): void {
    switch (this.currentTool) {
      case "pan":
        this.canvas.style.cursor = "grab";
        break;
      case "select":
        this.canvas.style.cursor = "pointer";
        break;
      case "draw":
        this.canvas.style.cursor = "crosshair";
        break;
      default:
        this.canvas.style.cursor = "default";
    }
  }

  public setShape(shape: Shapes): void {
    this.currentShape = shape;
    this.currentTool = "draw";
    this.updateCursor();
  }

  public setColor(color: FillColor): void {
    this.currentColor = color;
  }

  public setTool(tool: Tool): void {
    this.currentTool = tool;
    this.updateCursor();
  }

  public deleteSelected(): void {
    if (this.readOnly) return; // Disable deletion in read-only mode
    
    if (this.selectedShapeId) {
      this.shapes.delete(this.selectedShapeId);
      this.broadcastMessage("shape_removed", { id: this.selectedShapeId });
      this.selectedShapeId = null;
      this.scheduleRedraw();
    }
  }

  public reset(): void {
    this.shapes.clear();
    this.broadcastMessage("state_sync", { shapes: [], viewport: this.viewport });
    this.scheduleRedraw();
  }

  public getState(): EngineState {
    return {
      shapes: Array.from(this.shapes.values()),
      viewport: { ...this.viewport }
    };
  }

  public destroy(): void {
    this.isDestroyed = true;

    // Clear reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Cancel animation frame
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Remove event listeners properly
    this.canvas.removeEventListener("mousedown", this.boundHandlers.mouseDown);
    this.canvas.removeEventListener("mousemove", this.boundHandlers.mouseMove);
    this.canvas.removeEventListener("mouseup", this.boundHandlers.mouseUp);
    this.canvas.removeEventListener("mouseleave", this.boundHandlers.mouseUp);
    this.canvas.removeEventListener("wheel", this.boundHandlers.wheel);

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Clear data
    this.shapes.clear();
    this.remoteCursors.clear();
  }
}