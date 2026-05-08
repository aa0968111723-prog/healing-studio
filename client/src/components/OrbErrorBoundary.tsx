import { Component, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// VisualSoul3D mounts a Three.js Canvas that can throw on devices without
// a usable WebGL context (low-end Android, GPU-blocked browsers, OOM).
// Without this boundary the error propagates to the route and blanks the page.
class OrbErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (typeof console !== "undefined") {
      console.warn("[OrbErrorBoundary] 3D orb failed, using CSS fallback:", error?.message);
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export default OrbErrorBoundary;
