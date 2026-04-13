export type AnimationCallback = (deltaTime: number) => void;

export class AnimationController {
  private animationRegistry: Map<string, AnimationCallback> = new Map();
  private animationId: number | null = null;
  private lastFrameTime: number = 0;

  public registerAnimation(name: string, callback: AnimationCallback): void {
    this.animationRegistry.set(name, callback);
    if (!this.animationId) {
      this.startAnimationLoop();
    }
  }

  public unregisterAnimation(name: string): void {
    this.animationRegistry.delete(name);
    if (this.animationRegistry.size === 0 && this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private startAnimationLoop(): void {
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(this.animationLoop.bind(this));
  }

  private animationLoop(currentTime: number): void {
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    this.animationRegistry.forEach(callback => {
      try {
        callback(deltaTime);
      } catch (error) {
        console.error('Animation callback error:', error);
      }
    });

    if (this.animationRegistry.size > 0) {
      this.animationId = requestAnimationFrame(this.animationLoop.bind(this));
    } else {
      this.animationId = null;
    }
  }

  public isRunning(): boolean {
    return this.animationId !== null;
  }

  public getRegisteredAnimations(): string[] {
    return Array.from(this.animationRegistry.keys());
  }
}

export const animationController = new AnimationController();
