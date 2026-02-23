import type { DriplElement } from "@dripl/common";
import type { AppState } from "@/types/canvas";
import type React from "react";

// Action source types for analytics
export type ActionSource = "ui" | "keyboard" | "contextMenu" | "api";

// Result type from performing an action
export type ActionResult =
  | {
      elements?: DriplElement[];
      appState?: Partial<AppState>;
      captureUpdate?: boolean;
    }
  | false;

// Action type definition
export interface Action {
  name: string;
  label: string;
  icon?: React.ReactNode;
  keywords?: string[];
  perform: (
    elements: DriplElement[],
    appState: AppState,
    value?: any,
    app?: any,
  ) => ActionResult;
  keyPriority?: number;
  keyTest?: (
    event: React.KeyboardEvent | KeyboardEvent,
    appState: AppState,
    elements: DriplElement[],
    app?: any,
  ) => boolean;
  predicate?: (
    elements: DriplElement[],
    appState: AppState,
    appProps: any,
    app?: any,
  ) => boolean;
  checked?: (appState: AppState) => boolean;
  trackEvent?: boolean | { category: string; action?: string };
  viewMode?: boolean;
}

// Action manager to coordinate actions
export class ActionManager {
  private actions: Map<string, Action> = new Map();

  constructor(
    private updater: (
      actionResult: ActionResult | Promise<ActionResult>,
    ) => void,
    private getAppState: () => AppState,
    private getElements: () => DriplElement[],
    private app?: any,
  ) {}

  registerAction(action: Action) {
    this.actions.set(action.name, action);
  }

  registerAll(actions: Action[]) {
    actions.forEach((action) => this.registerAction(action));
  }

  getAction(name: string): Action | undefined {
    return this.actions.get(name);
  }

  getAllActions(): Action[] {
    return Array.from(this.actions.values());
  }

  executeAction(
    action: Action | string,
    source: ActionSource = "api",
    value: any = null,
  ): void {
    const actionInstance =
      typeof action === "string" ? this.getAction(action) : action;

    if (!actionInstance) {
      console.warn(
        `Action not found: ${typeof action === "string" ? action : "unknown"}`,
      );
      return;
    }

    // Check if action is enabled
    if (
      actionInstance.predicate &&
      !actionInstance.predicate(
        this.getElements(),
        this.getAppState(),
        null,
        this.app,
      )
    ) {
      return;
    }

    // Track event
    if (actionInstance.trackEvent) {
      const category =
        typeof actionInstance.trackEvent === "object"
          ? actionInstance.trackEvent.category
          : "actions";
      const actionName =
        typeof actionInstance.trackEvent === "object"
          ? actionInstance.trackEvent.action || actionInstance.name
          : actionInstance.name;

      console.log(
        `[Analytics] Tracked action: ${actionName} (${category}) from ${source}`,
      );
    }

    // Perform action
    const actionResult = actionInstance.perform(
      this.getElements(),
      this.getAppState(),
      value,
      this.app,
    );

    // Update app state
    if (actionResult !== false) {
      this.updater(actionResult);
    }
  }

  handleKeyDown(event: React.KeyboardEvent | KeyboardEvent): boolean {
    const canvasActions = this.app?.props?.canvasActions || {};

    const matchingActions = Array.from(this.actions.values())
      .sort((a, b) => (b.keyPriority || 0) - (a.keyPriority || 0))
      .filter(
        (action) =>
          canvasActions[action.name] !== false &&
          action.keyTest &&
          action.keyTest(
            event,
            this.getAppState(),
            this.getElements(),
            this.app,
          ),
      );

    if (matchingActions.length !== 1) {
      if (matchingActions.length > 1) {
        console.warn(
          "Multiple actions match shortcut:",
          matchingActions.map((a) => a.name),
        );
      }
      return false;
    }

    const action = matchingActions[0] as Action;

    event.preventDefault();
    event.stopPropagation();
    this.executeAction(action, "keyboard");

    return true;
  }
}

// Helper function to track actions
export function trackAction(
  action: Action,
  source: ActionSource,
  appState: AppState,
  elements: DriplElement[],
  app: any,
  value: any,
): void {
  if (action.trackEvent) {
    const category =
      typeof action.trackEvent === "object"
        ? action.trackEvent.category
        : "actions";
    const actionName =
      typeof action.trackEvent === "object"
        ? action.trackEvent.action || action.name
        : action.name;

    console.log(
      `[Analytics] Tracked action: ${actionName} (${category}) from ${source}`,
    );
  }
}
