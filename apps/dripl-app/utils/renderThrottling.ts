import { AnimationController } from "./animationController";

// Throttling configuration
const RENDER_THROTTLE_MS = 16; // ~60fps limit

// Track last render time and pending requests
let lastRenderTime = 0;
let pendingRenderCallback: (() => void) | null = null;

/**
 * Throttle render calls to ensure they don't exceed a maximum rate
 */
export function throttleRender(callback: () => void): void {
  const now = Date.now();
  
  // If we're within the throttle window, schedule a future call
  if (now - lastRenderTime < RENDER_THROTTLE_MS) {
    // If there's already a pending request, cancel it
    if (pendingRenderCallback) {
      return; // Already scheduled
    }
    
    // Schedule next render after throttle window
    const delay = RENDER_THROTTLE_MS - (now - lastRenderTime);
    pendingRenderCallback = callback;
    
    setTimeout(() => {
      if (pendingRenderCallback === callback) {
        pendingRenderCallback = null;
        lastRenderTime = Date.now();
        callback();
      }
    }, delay);
  } else {
    // If we're outside the throttle window, execute immediately
    lastRenderTime = now;
    callback();
  }
}

/**
 * Throttle render using requestAnimationFrame for smoother results
 */
export function throttleRenderRAF(callback: () => void): void {
  const now = Date.now();
  
  if (now - lastRenderTime < RENDER_THROTTLE_MS) {
    if (!pendingRenderCallback) {
      pendingRenderCallback = callback;
      requestAnimationFrame(() => {
        if (pendingRenderCallback === callback) {
          pendingRenderCallback = null;
          lastRenderTime = Date.now();
          callback();
        }
      });
    }
  } else {
    lastRenderTime = now;
    callback();
  }
}

/**
 * Clear any pending render requests
 */
export function clearPendingRender(): void {
  pendingRenderCallback = null;
}

/**
 * Check if there's a pending render request
 */
export function hasPendingRender(): boolean {
  return pendingRenderCallback !== null;
}
