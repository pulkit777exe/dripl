import type { DriplElement } from "@dripl/common";

type AnimationKey = string;
type AnimationState = Record<string, any>;
type AnimationUpdate = (
  state: AnimationState
) => AnimationState | undefined;

interface AnimationInfo {
  key: AnimationKey;
  update: AnimationUpdate;
  state: AnimationState;
  active: boolean;
}

class AnimationController {
  private static animations = new Map<AnimationKey, AnimationInfo>();

  static start(
    key: AnimationKey,
    update: AnimationUpdate,
    initialState: AnimationState = {}
  ): void {
    if (this.animations.has(key)) {
      return;
    }

    const animation: AnimationInfo = {
      key,
      update,
      state: initialState,
      active: true,
    };

    this.animations.set(key, animation);

    const animate = () => {
      const anim = this.animations.get(key);
      if (!anim || !anim.active) {
        return;
      }

      const nextState = anim.update(anim.state);
      if (nextState !== undefined) {
        anim.state = nextState;
        requestAnimationFrame(animate);
      } else {
        this.animations.delete(key);
      }
    };

    requestAnimationFrame(animate);
  }

  static stop(key: AnimationKey): void {
    const animation = this.animations.get(key);
    if (animation) {
      animation.active = false;
    }
  }

  static running(key: AnimationKey): boolean {
    return this.animations.has(key);
  }

  static getState(key: AnimationKey): AnimationState | undefined {
    const animation = this.animations.get(key);
    return animation?.state;
  }
}

export { AnimationController };
export type { AnimationKey, AnimationState, AnimationUpdate };
