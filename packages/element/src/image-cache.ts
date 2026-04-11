export interface CachedImage {
  image: HTMLImageElement;
  width: number;
  height: number;
  loaded: boolean;
  error: boolean;
}

export interface ImageCacheOptions {
  maxSize?: number;
  preloadTimeout?: number;
}

const DEFAULT_OPTIONS: Required<ImageCacheOptions> = {
  maxSize: 100,
  preloadTimeout: 5000,
};

class ImageCacheImpl {
  private cache = new Map<string, CachedImage>();
  private maxSize: number;
  private preloadTimeout: number;
  private loadingPromises = new Map<string, Promise<CachedImage>>();
  private accessOrder: string[] = [];

  constructor(options: ImageCacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_OPTIONS.maxSize;
    this.preloadTimeout = options.preloadTimeout ?? DEFAULT_OPTIONS.preloadTimeout;
  }

  get(src: string): CachedImage | undefined {
    const cached = this.cache.get(src);
    if (cached) {
      this.updateAccessOrder(src);
    }
    return cached;
  }

  async load(src: string): Promise<CachedImage> {
    const existing = this.cache.get(src);
    if (existing?.loaded) {
      this.updateAccessOrder(src);
      return existing;
    }

    const existingPromise = this.loadingPromises.get(src);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.loadImage(src);
    this.loadingPromises.set(src, promise);

    try {
      const cached = await promise;
      this.evictIfNeeded();
      return cached;
    } finally {
      this.loadingPromises.delete(src);
    }
  }

  private async loadImage(src: string): Promise<CachedImage> {
    return new Promise(resolve => {
      const img = new Image();

      const cached: CachedImage = {
        image: img,
        width: 0,
        height: 0,
        loaded: false,
        error: false,
      };

      const timeout = setTimeout(() => {
        cached.error = true;
        resolve(cached);
      }, this.preloadTimeout);

      img.onload = () => {
        clearTimeout(timeout);
        cached.loaded = true;
        cached.width = img.width;
        cached.height = img.height;
        this.cache.set(src, cached);
        this.accessOrder.push(src);
        resolve(cached);
      };

      img.onerror = () => {
        clearTimeout(timeout);
        cached.error = true;
        this.cache.set(src, cached);
        this.accessOrder.push(src);
        resolve(cached);
      };

      img.src = src;
    });
  }

  private updateAccessOrder(src: string): void {
    const index = this.accessOrder.indexOf(src);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(src);
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }
  }

  preload(src: string): void {
    if (!this.cache.has(src) && !this.loadingPromises.has(src)) {
      this.load(src).catch(() => {});
    }
  }

  preloadMultiple(sources: string[]): void {
    sources.forEach(src => this.preload(src));
  }

  has(src: string): boolean {
    return this.cache.has(src);
  }

  isLoaded(src: string): boolean {
    const cached = this.cache.get(src);
    return cached?.loaded ?? false;
  }

  isError(src: string): boolean {
    const cached = this.cache.get(src);
    return cached?.error ?? false;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.loadingPromises.clear();
  }

  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  remove(src: string): void {
    this.cache.delete(src);
    const index = this.accessOrder.indexOf(src);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }
}

export const imageCache = new ImageCacheImpl();

export function createImageCache(options?: ImageCacheOptions): ImageCacheImpl {
  return new ImageCacheImpl(options);
}
