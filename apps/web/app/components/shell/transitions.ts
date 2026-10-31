// Article links cross-fade; other opted-in phone links retain their directional transition.
// Browser history keeps its own motion and restores keyboard context without moving the scroll position.
import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";
import { isPhone } from "./screens";

let goingBack = false;

/** Called just before navigating back from the app's own controls (the bar's back button, a tab tapped deeper in). */
export function markBack() {
  goingBack = true;
}

/** In the root: marks the direction of each page change while it is committed, before the transition animates. */
export function usePageTransition() {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    const from = previous.current;
    const articleFromList = from === "/" && pathname.startsWith("/items/");
    document.documentElement.dataset.vt = articleFromList && type !== "POP" ? "article" : !isPhone() ? "none" : goingBack ? "back" : type === "POP" ? "none" : "push";
    if (articleFromList) document.querySelector<HTMLHeadingElement>("#main h1")?.focus({ preventScroll: true });
    if (type === "POP" && pathname === "/" && from.startsWith("/items/")) {
      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("#main a[href]")).find(link => link.pathname === from);
      link?.focus({ preventScroll: true });
    }
    previous.current = pathname;
    goingBack = false;
  }, [key, pathname, type]);
}
