import { DriplElementSchema, MAX_SCENE_ELEMENTS } from '@dripl/common';

export function isValidSceneContent(content: unknown): boolean {
  const candidate = Array.isArray(content)
    ? content
    : content && typeof content === 'object' && 'elements' in content
      ? (content as { elements?: unknown }).elements
      : null;
  if (!Array.isArray(candidate) || candidate.length > MAX_SCENE_ELEMENTS) return false;
  return candidate.every(element => DriplElementSchema.safeParse(element).success);
}
