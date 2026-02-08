"use client";

import { useState, useCallback } from "react";
import type { DriplElement, Point } from "@dripl/common";
import type { Binding } from "@/utils/bindingUtils";
import {
  getSnapPoint,
  hasBindings,
  getElementBindings,
  updateBindingsForElement,
} from "@/utils/bindingUtils";
import { v4 as uuidv4 } from "uuid";

export interface UseBindingSystemReturn {
  bindings: Binding[];
  createBinding: (
    sourceElementId: string,
    targetElementId: string,
    sourcePoint: Point,
    targetPoint: Point,
    type: "arrow" | "line" | "curve",
  ) => void;
  deleteBinding: (bindingId: string) => void;
  deleteBindingsForElement: (elementId: string) => void;
  updateBindingsOnMove: (elementId: string, dx: number, dy: number) => void;
  getSnapPoint: (point: Point, elements: DriplElement[]) => Point | null;
  hasBindings: (elementId: string) => boolean;
  getElementBindings: (elementId: string) => Binding[];
}

export function useBindingSystem(): UseBindingSystemReturn {
  const [bindings, setBindings] = useState<Binding[]>([]);

  const createBinding = useCallback(
    (
      sourceElementId: string,
      targetElementId: string,
      sourcePoint: Point,
      targetPoint: Point,
      type: "arrow" | "line" | "curve",
    ) => {
      const newBinding: Binding = {
        id: uuidv4(),
        sourceElementId,
        targetElementId,
        sourcePoint,
        targetPoint,
        type,
        properties: {
          strokeColor: "#000000",
          strokeWidth: 2,
          strokeStyle: "solid",
          opacity: 1,
        },
      };

      setBindings((prev) => [...prev, newBinding]);
    },
    [],
  );

  const deleteBinding = useCallback((bindingId: string) => {
    setBindings((prev) => prev.filter((binding) => binding.id !== bindingId));
  }, []);

  const deleteBindingsForElement = useCallback((elementId: string) => {
    setBindings((prev) =>
      prev.filter(
        (binding) =>
          binding.sourceElementId !== elementId &&
          binding.targetElementId !== elementId,
      ),
    );
  }, []);

  const updateBindingsOnMove = useCallback(
    (elementId: string, dx: number, dy: number) => {
      setBindings((prev) => updateBindingsForElement(elementId, dx, dy, prev));
    },
    [],
  );

  const getSnapPointCallback = useCallback(
    (point: Point, elements: DriplElement[]) => {
      return getSnapPoint(point, elements);
    },
    [],
  );

  const hasBindingsCallback = useCallback(
    (elementId: string) => {
      return hasBindings(elementId, bindings);
    },
    [bindings],
  );

  const getElementBindingsCallback = useCallback(
    (elementId: string) => {
      return getElementBindings(elementId, bindings);
    },
    [bindings],
  );

  return {
    bindings,
    createBinding,
    deleteBinding,
    deleteBindingsForElement,
    updateBindingsOnMove,
    getSnapPoint: getSnapPointCallback,
    hasBindings: hasBindingsCallback,
    getElementBindings: getElementBindingsCallback,
  };
}
