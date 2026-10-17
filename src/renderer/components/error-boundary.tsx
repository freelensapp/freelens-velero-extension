import { Common, type Renderer } from "@freelensapp/extensions";
import React from "react";
import { ErrorPage } from "./error-page";

type PageRegistration = Renderer.LensExtension["clusterPages"][number];
type DetailRegistration = Renderer.LensExtension["kubeObjectDetailItems"][number];
type MenuRegistration = Renderer.LensExtension["kubeObjectMenuItems"][number];

export interface ErrorBoundaryProps {
  extension: Renderer.LensExtension;
  // What is drawn in place of what threw: the error page, or nothing for an item of a menu of the host, where
  // a page does not fit.
  fallback?: "error-page" | "nothing";
  // A new value draws what is inside again: the object of a section of the details or of an item of a menu,
  // which the host gives anew when the object changes.
  resetKey?: unknown;
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  error?: unknown;
  resetKey?: unknown;
}

// What keeps an error of a part of the extension in its place. An error thrown while React draws what is
// inside is given to the log of the host with the name of the extension and the stack of the components, and
// the error page, or nothing, is drawn in place of what threw. The host has no boundary around the drawer of
// the details or an item of a menu, and its boundary around the frame of a cluster would replace the whole
// view of the cluster. A `try` around the call of a component does not see such an error: a child is drawn
// after the call, and the host calls `renderTableContents` of its list from its own render.
//
// It is a class component, the one kind React lets keep an error, of the React of the host, with no
// decorator and no `observer`: it reads no observable, and what it holds observes for itself.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { failed: true, error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): ErrorBoundaryState | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    Common.logger.error(`[${this.props.extension.name}]: ${error}`, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback === "nothing") return null;
    return <ErrorPage error={this.state.error} />;
  }
}

// The registration of a page of a cluster, with the page inside a boundary.
export function withPageErrorBoundary(
  extension: Renderer.LensExtension,
  registration: PageRegistration,
): PageRegistration {
  const { Page } = registration.components;

  return {
    ...registration,
    components: {
      ...registration.components,
      Page: (props) => (
        <ErrorBoundary extension={extension}>
          <Page {...props} />
        </ErrorBoundary>
      ),
    },
  };
}

// The registration of a section of the details, made by `Renderer.K8sApi.detailsFor`, with the section inside
// a boundary that draws it again for another object.
export function withDetailsErrorBoundary(
  extension: Renderer.LensExtension,
  registration: DetailRegistration,
): DetailRegistration {
  const { Details } = registration.components;

  return {
    ...registration,
    components: {
      ...registration.components,
      Details: (props) => (
        <ErrorBoundary extension={extension} resetKey={props.object}>
          <Details {...props} />
        </ErrorBoundary>
      ),
    },
  };
}

// The registration of an item of a menu, made by `Renderer.K8sApi.menuItemFor`, with the item inside a boundary
// that draws nothing in the menu after an error, and draws the item again for another object. No item of a
// menu is registered yet: a spec that adds one registers it through this.
export function withMenuItemErrorBoundary(
  extension: Renderer.LensExtension,
  registration: MenuRegistration,
): MenuRegistration {
  const { MenuItem } = registration.components;

  return {
    ...registration,
    components: {
      ...registration.components,
      MenuItem: (props) => (
        <ErrorBoundary extension={extension} fallback="nothing" resetKey={props.object}>
          <MenuItem {...props} />
        </ErrorBoundary>
      ),
    },
  };
}
