export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function throttle(func: Function, limit: number) {
  let inThrottle: boolean;
  return function (this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export * from "./encryption/index";
export * from "./storage/index";
