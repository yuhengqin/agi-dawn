import { createContext, useContext, type RefObject } from "react";
import { Link, useLocation, type LinkProps } from "react-router";

export type InfoPath = "/about" | "/changelog" | "/feedback";
export const InfoDialogContext = createContext<((path: InfoPath, opener: HTMLElement) => void) | null>(null);

function isInfoPath(to: string): to is InfoPath {
  return to === "/about" || to === "/changelog" || to === "/feedback";
}

/** The link remains a direct URL for new tabs, narrow layouts and unhydrated pages. */
export function InfoLink({ to, opener, onClick, ...props }: Omit<LinkProps, "to"> & {
  to: string;
  opener?: RefObject<HTMLButtonElement | null>;
}) {
  const openDialog = useContext(InfoDialogContext);
  const { pathname } = useLocation();
  return <Link to={to} {...props} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (props.target && props.target !== "_self") || !openDialog || !isInfoPath(to) || pathname === to
      || !window.matchMedia("(min-width: 961px)").matches) return;
    event.preventDefault();
    openDialog(to, opener?.current ?? event.currentTarget);
  }} />;
}
