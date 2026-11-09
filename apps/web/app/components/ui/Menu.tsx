import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useRef, useState, type ReactNode } from "react";

/** A small non-modal dropdown; outside controls remain actionable while it is open. */
export function Menu({ trigger, label, children, triggerClassName }: {
  trigger: ReactNode; label: string; children: (close: () => void) => ReactNode; triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const lastOnOpen = useRef(false), tabExit = useRef(false);
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <div className="relative">
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            ref={button}
            aria-label={label}
            title={label}
            onPointerDown={() => { lastOnOpen.current = false; }}
            onKeyDown={event => {
              lastOnOpen.current = event.key === "ArrowUp";
              if (lastOnOpen.current) { event.preventDefault(); setOpen(true); }
            }}
            className={triggerClassName ?? `inline-flex size-11 items-center justify-center rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-accent ${open ? "bg-bg-sunk text-ink" : "text-ink-3 hover:bg-bg-sunk hover:text-ink"}`}
          >
            {trigger}
          </button>
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={panel}
          aria-label={label}
          align="end"
          sideOffset={4}
          collisionPadding={12}
          loop
          onFocus={event => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? []);
            (items.at(lastOnOpen.current ? -1 : 0) ?? panel.current)?.focus();
          }}
          onKeyDownCapture={event => {
            // Keep native Tab traversal from the trigger, rather than trapping Tab in the menu.
            if (event.key !== "Tab") return;
            tabExit.current = true;
            button.current?.focus();
            setOpen(false);
            event.stopPropagation();
          }}
          onCloseAutoFocus={event => {
            if (tabExit.current) event.preventDefault();
            tabExit.current = false;
          }}
          className="z-50 w-max min-w-[168px] max-w-[calc(100vw-24px)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-control border border-line bg-raised py-1 shadow-[var(--shadow-pop)]"
        >
          {children(() => setOpen(false))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One entry of a Menu (a button or a link). */
export function MenuItem({ icon, children, onSelect, href, download, target, rel }: { icon?: ReactNode; children: ReactNode; onSelect?: () => void; href?: string; download?: boolean;target?:string;rel?:string }) {
  const cls = "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-bg-sunk hover:text-ink focus-visible:bg-bg-sunk focus-visible:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
  const inner = (
    <>
      {icon && <span className="text-ink-4">{icon}</span>}
      {children}
    </>
  );
  return (
    <DropdownMenu.Item asChild onSelect={onSelect}>
      {href
        ? <a href={href} download={download} target={target} rel={rel} className={cls}>{inner}</a>
        : <button type="button" className={cls}>{inner}</button>}
    </DropdownMenu.Item>
  );
}
