/**
 * Tunnel Pattern for React
 *
 * Allows child components to "tunnel" content to ancestor outlets,
 * avoiding prop drilling while keeping UI components dumb.
 *
 * Usage:
 * 1. Wrap your app with TunnelProvider
 * 2. Use <TunnelOutlet name="menu" /> where content should render
 * 3. Use <TunnelInlet name="menu">content</TunnelInlet> to tunnel content
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface TunnelContextValue {
  tunnels: Map<string, ReactNode>;
  setTunnel: (name: string, content: ReactNode) => void;
  clearTunnel: (name: string) => void;
}

const TunnelContext = createContext<TunnelContextValue | null>(null);

interface TunnelProviderProps {
  children: ReactNode;
}

/**
 * Provider that holds all tunnel content
 */
export function TunnelProvider({ children }: TunnelProviderProps): React.JSX.Element {
  const [tunnels, setTunnels] = useState<Map<string, ReactNode>>(new Map());

  const setTunnel = useCallback((name: string, content: ReactNode): void => {
    setTunnels(prev => {
      const next = new Map(prev);
      next.set(name, content);
      return next;
    });
  }, []);

  const clearTunnel = useCallback((name: string): void => {
    setTunnels(prev => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ tunnels, setTunnel, clearTunnel }),
    [tunnels, setTunnel, clearTunnel]
  );

  return <TunnelContext.Provider value={value}>{children}</TunnelContext.Provider>;
}

/**
 * Hook to access tunnel context
 */
export function useTunnel(): TunnelContextValue {
  const context = useContext(TunnelContext);
  if (!context) {
    throw new Error('useTunnel must be used within a TunnelProvider');
  }
  return context;
}

interface TunnelOutletProps {
  name: string;
  fallback?: ReactNode;
}

/**
 * Outlet - renders the tunneled content at this location
 */
export function TunnelOutlet({ name, fallback = null }: TunnelOutletProps): React.JSX.Element {
  const { tunnels } = useTunnel();
  return <>{tunnels.get(name) ?? fallback}</>;
}

interface TunnelInletProps {
  name: string;
  children: ReactNode;
}

/**
 * Inlet - sends content to the named outlet
 */
export function TunnelInlet({ name, children }: TunnelInletProps): null {
  const { setTunnel, clearTunnel } = useTunnel();

  React.useEffect(() => {
    setTunnel(name, children);
    return () => clearTunnel(name);
  }, [name, children, setTunnel, clearTunnel]);

  // This component renders nothing - content appears at the outlet
  return null;
}

// Predefined tunnel names for Dripl
export const TUNNEL_NAMES = {
  MENU: 'menu',
  TOOLBAR: 'toolbar',
  PROPERTIES: 'properties',
  STATUS_BAR: 'statusBar',
} as const;
