/**
 * Pre-configured tunnel components for Dripl canvas
 */

import React, { ReactNode } from "react";
import { TunnelInlet, TunnelOutlet, TUNNEL_NAMES } from "./TunnelContext.js";

// Menu tunnels - content flows from Canvas to TopBar
export function MenuInlet({ children }: { children: ReactNode }) {
  return <TunnelInlet name={TUNNEL_NAMES.MENU}>{children}</TunnelInlet>;
}

export function MenuOutlet({ fallback }: { fallback?: ReactNode }) {
  return <TunnelOutlet name={TUNNEL_NAMES.MENU} fallback={fallback} />;
}

// Toolbar tunnels - content flows from Canvas to left sidebar
export function ToolbarInlet({ children }: { children: ReactNode }) {
  return <TunnelInlet name={TUNNEL_NAMES.TOOLBAR}>{children}</TunnelInlet>;
}

export function ToolbarOutlet({ fallback }: { fallback?: ReactNode }) {
  return <TunnelOutlet name={TUNNEL_NAMES.TOOLBAR} fallback={fallback} />;
}

// Properties panel tunnels - content flows from Canvas to right panel
export function PropertiesInlet({ children }: { children: ReactNode }) {
  return <TunnelInlet name={TUNNEL_NAMES.PROPERTIES}>{children}</TunnelInlet>;
}

export function PropertiesOutlet({ fallback }: { fallback?: ReactNode }) {
  return <TunnelOutlet name={TUNNEL_NAMES.PROPERTIES} fallback={fallback} />;
}

// Status bar tunnels - content flows from Canvas to bottom status bar
export function StatusBarInlet({ children }: { children: ReactNode }) {
  return <TunnelInlet name={TUNNEL_NAMES.STATUS_BAR}>{children}</TunnelInlet>;
}

export function StatusBarOutlet({ fallback }: { fallback?: ReactNode }) {
  return <TunnelOutlet name={TUNNEL_NAMES.STATUS_BAR} fallback={fallback} />;
}
