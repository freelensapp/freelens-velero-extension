import { observer } from "mobx-react";
import React from "react";
import { VIEWS } from "../../common/views";
import { closeView, closeViews, openViews } from "../navigation";
import { EntryState } from "./entry-state";
import { Styles } from "./styles";
import { Coverage, TargetBar } from "./target-bar";
import styles from "./views.module.css";

import type { ReactNode } from "react";

import type { Family } from "../../common/discovery";
import type { ViewTarget } from "../../common/views";
import type { Installation } from "../state/installation";

export interface OpenViewProps {
  installation: Installation;
  target: ViewTarget;
  now: number;
  // Where the way back leads, in words.
  back: string;
  onBack: () => void;
}

// The clock of the views: one reading for every row, taken again while a view is open.
export function useNow(interval = 5000): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);

    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

// The focus of a control that goes away when it is used is given to the first that is found of what it
// was of: left where the control was, it would be of nothing, and the keyboard would begin from the top.
export function focusFirst(within: HTMLElement | null, selectors: string[]): void {
  for (const selector of selectors) {
    const found = within?.querySelector<HTMLElement>(selector);

    if (found) {
      found.focus();
      return;
    }
  }
}

// For how long what was pointed at is what a view was opened from: a view opens in the frame after the
// click or the key that asked for it.
const POINTED = 1000;

export interface ViewsFrameProps {
  // How the page is found by the suites: `velero-<id>-page`.
  id: string;
  // What the page is of, which is where the way back of the first view leads, in words.
  title: string;
  installation: Installation;
  // The families the page is made from: what is missing of them is said over it while no view is open.
  families: Family[];
  // The other families a part of the page is made from: the page says when they are of an earlier read.
  earlier?: Family[];
  // The view of one object, of whatever kind the address names.
  view(props: OpenViewProps): ReactNode;
  // What a view was opened from, where what was pointed at is not there any more: who comes back is where
  // they were.
  origin(root: HTMLElement, target: ViewTarget): HTMLElement | undefined;
  // What the page shows of the installation, with the clock of the views.
  children(now: number): ReactNode;
}

// What every page of the extension has around what it shows: the target bar, what is missing of the
// installation, and, over what the page shows, the view of the object that is open. What the page shows
// stays where it is while a view is open: a view opened from another one is over the same page, and every
// way back ends on it.
function ViewsFrameView({ id, title, installation, families, earlier, view, origin, children }: ViewsFrameProps) {
  const now = useNow();
  const path = openViews();
  const open = path[path.length - 1];
  const before = path[path.length - 2];
  const first = path[0];
  const ready = installation.entry.state === "ready";
  const content = React.useRef<HTMLDivElement>(null);
  const opened = React.useRef<ViewTarget>();
  // What was last pointed at, or reached with the keyboard, in the page, and when.
  const pointed = React.useRef<{ element: HTMLElement; at: number }>();
  // What the first view of a way was opened from.
  const from = React.useRef<HTMLElement>();
  const shown = open ? `${open.kind}/${open.name}` : "";

  React.useEffect(() => {
    void installation.open();
    return installation.watch();
  }, [installation]);

  // The views that are open are of the installation they were opened in: with another one selected, the
  // way back would name what the other does not have.
  const namespace = installation.namespace;
  const shownOf = React.useRef(namespace);

  React.useEffect(() => {
    if (namespace === undefined) return;
    if (shownOf.current !== undefined && shownOf.current !== namespace && openViews().length) closeViews();
    shownOf.current = namespace;
  }, [namespace]);

  // Who comes back to the page is where they were: on what they had opened the view from.
  React.useEffect(() => {
    if (open) {
      // The first view of a way was opened from what was pointed at a moment before. One that opens
      // by itself, from the address, was opened from nothing of the page.
      if (opened.current === undefined) {
        const last = pointed.current;

        from.current = last && performance.now() - last.at < POINTED ? last.element : undefined;
      }
      opened.current = first;
      return;
    }
    const target = opened.current;
    const source = from.current;
    let frame = 0;
    let tries = 0;
    // The list of the host may draw its rows again when it is shown: the focus is given to what is there,
    // and again if what had it was replaced and nothing has it. Once the operator moved it somewhere else
    // it is theirs: nothing takes it back.
    const focus = () => {
      const root = content.current;
      // What the view was opened from, when it is still there: the same object may be named in more
      // than one place of a page, and the first of them is not where the operator was.
      const kept = source?.isConnected && root?.contains(source) ? source : undefined;
      const element = kept ?? (root && target ? origin(root, target) : undefined);
      const active = document.activeElement;
      const free = active === null || active === document.body || !document.body.contains(active);

      if (tries > 0 && !free && active !== element) return;
      // The page is where it was scrolled: the focus does not move it.
      if (active !== element) element?.focus({ preventScroll: true });
      tries += 1;
      if (tries < 20) frame = requestAnimationFrame(focus);
    };

    opened.current = undefined;
    from.current = undefined;
    if (!target) return;
    focus();
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  const remember = (event: React.SyntheticEvent) => {
    if (open) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("button, a");

    pointed.current = element ? { element, at: performance.now() } : undefined;
  };

  // The host lays the page out, with the tabs of the group over it: a layout of the host inside that
  // one would give the page its margins twice, and less room than it has.
  return (
    <>
      <Styles />
      <div className={styles.page} data-testid={`velero-${id}-page`}>
        <TargetBar installation={installation} />
        <Coverage
          installation={installation}
          families={open ? [...VIEWS[open.kind].reads] : families}
          earlier={open ? [] : earlier}
        />
        {ready ? (
          <div className={styles.content}>
            {/* What opens a view is remembered when it is pointed at, or reached with the keyboard. */}
            <div
              ref={content}
              className={`${styles.content} ${open ? styles.behind : ""}`}
              aria-hidden={open ? true : undefined}
              onClickCapture={remember}
              onKeyDownCapture={remember}
            >
              {children(now)}
            </div>
            {open ? (
              <div className={styles.over}>
                {view({
                  installation,
                  target: open,
                  now,
                  back: before ? `${VIEWS[before.kind].title} / ${before.name}` : title,
                  onBack: closeView,
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <EntryState installation={installation} />
        )}
      </div>
    </>
  );
}

export const ViewsFrame = observer(ViewsFrameView);
