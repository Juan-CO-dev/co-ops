"use client";

/**
 * Catches anything the three.js floor throws while RENDERING (a failed chunk import surfaces here as a
 * render-time throw from next/dynamic) and reports it to the parent, which swaps in the 2D map.
 * Effect-time failures (renderer init) come back through Floor3D's own `onFailure`. Class component
 * because error boundaries still have no hook form.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export class Floor3DBoundary extends Component<{ onFailure: (reason: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error("pulse floor 3d render failed", error);
    this.props.onFailure(error.message);
  }
  render(): ReactNode { return this.state.failed ? null : this.props.children; }
}
