import { createContext, use, type ReactNode } from "react";

export interface ComposerSurfaceEnvironmentValue {
  readonly window: Window & typeof globalThis;
  readonly document: Document;
  readonly portalContainer: HTMLElement;
}

const ComposerSurfaceEnvironmentContext = createContext<ComposerSurfaceEnvironmentValue | null>(
  null,
);

export function ComposerSurfaceEnvironmentProvider(props: {
  readonly value: ComposerSurfaceEnvironmentValue;
  readonly children: ReactNode;
}) {
  return (
    <ComposerSurfaceEnvironmentContext value={props.value}>
      {props.children}
    </ComposerSurfaceEnvironmentContext>
  );
}

export function useComposerSurfaceEnvironment(): ComposerSurfaceEnvironmentValue {
  const environment = use(ComposerSurfaceEnvironmentContext);
  if (environment) return environment;
  return {
    window,
    document,
    portalContainer: document.body,
  };
}

export function useComposerPortalContainer(): HTMLElement | undefined {
  const environment = use(ComposerSurfaceEnvironmentContext);
  if (environment) return environment.portalContainer;
  return typeof document === "undefined" ? undefined : document.body;
}
