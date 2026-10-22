// What a browser lays out of a list that react-window windows, which jsdom lays out not at all: the room of
// the part of the list that scrolls, how tall what it holds is, how far it can be scrolled, the scroll to a
// place, and the size the observers of its room are told. The component tests of the lists of lines and of
// the resource list install it, and say what room a list has: react-window and the views are the real ones.
//
// The part that scrolls is the element react-window draws for a list, whose last child is as tall as its
// rows, and every other element keeps what jsdom gives it. As a browser does, it is never scrolled past
// its end, and a scroll that moves it sends its event with the next frame, after what scrolled it: a test
// that scrolls a list as the operator does sends the event itself, as that frame would. An observer is told
// the size of what it observes when it begins to observe it and when the room changes, at once, where a
// browser tells it with the next frame; and the room is the one a test gives, the same for every list,
// where a browser lays each out in its own.

import { act } from "@testing-library/react";

// The room of the part of a list that scrolls, in pixels.
export const room = { height: 0, width: 0 };

const SIZER = "data-react-window-sizer";
const observers = new Set<Observer>();
let installed = false;

// The part of a list that scrolls, which holds the element as tall as its rows as its last child.
function scrolls(element: Element): boolean {
  return element.lastElementChild?.hasAttribute(SIZER) ?? false;
}

// How tall what the part that scrolls holds is: the height react-window gives the element of its rows.
function holds(element: Element): number {
  return Number.parseFloat((element.lastElementChild as HTMLElement).style.height) || 0;
}

function size(target: Element): ResizeObserverEntry {
  const width = target.clientWidth;
  const height = target.clientHeight;
  const box = [{ blockSize: height, inlineSize: width }];

  return {
    target,
    contentRect: { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) },
    borderBoxSize: box,
    contentBoxSize: box,
    devicePixelContentBoxSize: box,
  };
}

class Observer implements ResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(private readonly told: ResizeObserverCallback) {
    observers.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
    this.tell([target]);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    observers.delete(this);
  }

  tell(targets: Element[] = [...this.targets]): void {
    if (targets.length) this.told(targets.map(size), this);
  }

  get observes(): boolean {
    return this.targets.size > 0;
  }
}

// How many observers observe something now.
export function observing(): number {
  return [...observers].filter((observer) => observer.observes).length;
}

function getter(name: "clientHeight" | "clientWidth" | "scrollHeight" | "scrollTop"): (this: Element) => number {
  const found = Object.getOwnPropertyDescriptor(Element.prototype, name)?.get;

  if (!found) throw new Error(`jsdom gives no ${name}`);
  return found;
}

// Lays out the lists of the page from now on, in this file of tests.
export function layOutLists(): void {
  if (installed) return;
  installed = true;
  const clientHeight = getter("clientHeight");
  const clientWidth = getter("clientWidth");
  const scrollHeight = getter("scrollHeight");
  const scrollTop = getter("scrollTop");
  const setScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")?.set as (
    this: Element,
    value: number,
  ) => void;

  Object.defineProperties(Element.prototype, {
    clientHeight: {
      configurable: true,
      get(this: Element) {
        return scrolls(this) ? room.height : clientHeight.call(this);
      },
    },
    clientWidth: {
      configurable: true,
      get(this: Element) {
        return scrolls(this) ? room.width : clientWidth.call(this);
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: Element) {
        return scrolls(this) ? Math.max(holds(this), room.height) : scrollHeight.call(this);
      },
    },
    scrollTop: {
      configurable: true,
      get: scrollTop,
      set(this: Element, value: number) {
        if (!scrolls(this)) {
          setScrollTop.call(this, value);
          return;
        }
        const from = scrollTop.call(this);

        setScrollTop.call(this, Math.max(0, Math.min(Math.max(0, holds(this) - room.height), value)));
        if (scrollTop.call(this) !== from) setTimeout(() => this.dispatchEvent(new Event("scroll")));
      },
    },
    scrollTo: {
      configurable: true,
      writable: true,
      value(this: Element, place?: ScrollToOptions | number, top?: number) {
        const to = typeof place === "number" ? top : place?.top;

        if (to !== undefined) this.scrollTop = to;
      },
    },
  });
  globalThis.ResizeObserver = Observer;
}

// The room of the lists changes, as it does when what holds them changes its size: their observers are told.
export function resize(to: Partial<typeof room>): void {
  Object.assign(room, to);
  act(() => {
    for (const observer of [...observers]) observer.tell();
  });
}

// Where react-window placed a row from the top of what the part that scrolls holds, in pixels.
export function rowTop(row: HTMLElement): number {
  return Number(/translateY\((-?[\d.]+)px\)/.exec(row.style.transform)?.[1] ?? Number.NaN);
}
