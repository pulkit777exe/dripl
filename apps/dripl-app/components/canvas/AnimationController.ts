type AnimationCallback<T = any> = (params: {
  deltaTime: number;
  state: T;
}) => T | undefined;

interface AnimationEntry<T = any> {
  callback: AnimationCallback<T>;
  state: T;
  lastTime: number;
}

class AnimationController {
  private static animations: Map<string, AnimationEntry> = new Map();
  private static animationFrameId: number | null = null;

  static start<T = any>(
    key: string,
    callback: AnimationCallback<T>,
    initialState: T = {} as T,
  ): void {
    if (this.animations.has(key)) {
      return;
    }

    this.animations.set(key, {
      callback,
      state: initialState,
      lastTime: performance.now(),
    });

    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(this.loop.bind(this));
    }
  }

  static stop(key: string): void {
    this.animations.delete(key);

    if (this.animations.size === 0 && this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  static running(key: string): boolean {
    return this.animations.has(key);
  }

  private static loop(): void {
    const now = performance.now();

    this.animations.forEach((entry, key) => {
      const deltaTime = now - entry.lastTime;
      entry.lastTime = now;

      const newState = entry.callback({
        deltaTime,
        state: entry.state,
      });

      if (newState === undefined) {
        this.stop(key);
      } else {
        entry.state = newState;
      }
    });

    if (this.animations.size > 0) {
      this.animationFrameId = requestAnimationFrame(this.loop.bind(this));
    }
  }
}

export { AnimationController };
