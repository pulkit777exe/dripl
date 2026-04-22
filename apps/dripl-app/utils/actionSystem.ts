import type { DriplElement } from '@dripl/common';
import type { AppState } from '@/types/canvas';
import type React from 'react';

// Action source types for analytics
export type ActionSource = 'ui' | 'keyboard' | 'contextMenu' | 'api';

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
    value?: unknown,
    app?: unknown
  ) => ActionResult;
  keyPriority?: number;
  keyTest?: (
    event: React.KeyboardEvent | KeyboardEvent,
    appState: AppState,
    elements: DriplElement[],
    app?: unknown
  ) => boolean;
  predicate?: (
    elements: DriplElement[],
    appState: AppState,
    appProps: unknown,
    app?: unknown
  ) => boolean;
  checked?: (appState: AppState) => boolean;
  trackEvent?: boolean | { category: string; action?: string };
  viewMode?: boolean;
}

// Action manager to coordinate actions
export class ActionManager {
  private actions: Map<string, Action> = new Map();

  constructor(
    private updater: (actionResult: ActionResult | Promise<ActionResult>) => void,
    private getAppState: () => AppState,
    private getElements: () => DriplElement[],
    private app?: unknown
  ) {}

  registerAction(action: Action) {
    this.actions.set(action.name, action);
  }

  registerAll(actions: Action[]) {
    actions.forEach(action => this.registerAction(action));
  }

  getAction(name: string): Action | undefined {
    return this.actions.get(name);
  }

  getAllActions(): Action[] {
    return Array.from(this.actions.values());
  }

  executeAction(
    action: Action | string,
    source: ActionSource = 'api',
    value: unknown = null
  ): void {
    const actionInstance = typeof action === 'string' ? this.getAction(action) : action;

    if (!actionInstance) {
      console.warn(`Action not found: ${typeof action === 'string' ? action : 'unknown'}`);
      return;
    }

    // Check if action is enabled
    const elements = this.getElements();
    const appState = this.getAppState();
    const appProps = (this.app as { props?: Record<string, unknown> } | undefined)?.props;

    if (
      actionInstance.predicate &&
      !actionInstance.predicate(
        elements,
        appState,
        appProps as { props?: Record<string, unknown> },
        this.app
      )
    ) {
      return;
    }

    // Track event
    if (actionInstance.trackEvent) {
      const category =
        typeof actionInstance.trackEvent === 'object'
          ? actionInstance.trackEvent.category
          : 'actions';
      const actionName =
        typeof actionInstance.trackEvent === 'object'
          ? actionInstance.trackEvent.action || actionInstance.name
          : actionInstance.name;
    }

    // Perform action
    const actionResult = actionInstance.perform(
      this.getElements(),
      this.getAppState(),
      value,
      this.app
    );

    // Update app state
    if (actionResult !== false) {
      this.updater(actionResult);
    }
  }

  handleKeyDown(event: React.KeyboardEvent | KeyboardEvent): boolean {
    const canvasActions =
      (this.app as { props?: { canvasActions?: Record<string, boolean> } } | undefined)?.props
        ?.canvasActions || {};

    const matchingActions = Array.from(this.actions.values())
      .sort((a, b) => (b.keyPriority || 0) - (a.keyPriority || 0))
      .filter(
        action =>
          canvasActions[action.name] !== false &&
          action.keyTest &&
          action.keyTest(event, this.getAppState(), this.getElements(), this.app)
      );

    if (matchingActions.length !== 1) {
      if (matchingActions.length > 1) {
        console.warn(
          'Multiple actions match shortcut:',
          matchingActions.map(a => a.name)
        );
      }
      return false;
    }

    const action = matchingActions[0] as Action;

    event.preventDefault();
    event.stopPropagation();
    this.executeAction(action, 'keyboard');

    return true;
  }
}

// Helper function to track actions
export function trackAction(
  action: Action,
  source: ActionSource,
  appState: AppState,
  elements: DriplElement[],
  app: unknown,
  value: unknown
): void {
  if (action.trackEvent) {
    const category = typeof action.trackEvent === 'object' ? action.trackEvent.category : 'actions';
    const actionName =
      typeof action.trackEvent === 'object' ? action.trackEvent.action || action.name : action.name;
  }
}
