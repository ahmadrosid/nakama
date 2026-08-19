import { Component, type ReactNode, Suspense } from "react";
import {
  type RouteErrorState,
  routeErrorStateFromResetKey,
} from "@/components/route-error-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface RouteBoundaryProps {
  children: ReactNode;
  fullScreen?: boolean;
  resetKey?: string;
}

// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require a class component.
class RouteErrorBoundary extends Component<
  RouteBoundaryProps,
  RouteErrorState
> {
  state: RouteErrorState = { failed: false };

  static getDerivedStateFromError(): Pick<RouteErrorState, "failed"> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: RouteBoundaryProps,
    state: RouteErrorState
  ): Partial<RouteErrorState> | null {
    return routeErrorStateFromResetKey(props.resetKey, state);
  }

  render() {
    if (this.state.failed) {
      return <RouteLoadError fullScreen={this.props.fullScreen} />;
    }

    return this.props.children;
  }
}

function RouteLoading({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-background",
        fullScreen ? "h-svh" : "h-full min-h-40"
      )}
    >
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

function RouteLoadError({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-background",
        fullScreen ? "h-svh" : "h-full min-h-40"
      )}
      role="alert"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="font-medium">This page couldn’t be loaded.</p>
        <Button onClick={() => window.location.reload()} type="button">
          Reload
        </Button>
      </div>
    </div>
  );
}

export function RouteBoundary({
  children,
  fullScreen,
  resetKey,
}: RouteBoundaryProps) {
  return (
    <RouteErrorBoundary fullScreen={fullScreen} resetKey={resetKey}>
      <Suspense fallback={<RouteLoading fullScreen={fullScreen} />}>
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}
