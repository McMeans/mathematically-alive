import type { ReactNode } from "react";

/**
 * One size for every action on the board header (Open in Lab, Share, Undo, Reset), on the team page and in the Lab:
 * 44px tall below `lg`, 36px from it, the same padding, label size and 1px border (Share's border is its own fill), so
 * a row of them lines up whatever each one says.
 */
export const BOARD_ACTION = "cond press flex h-11 shrink-0 items-center justify-center gap-1.5 min-w-24 whitespace-nowrap rounded-[3px] border px-3.5 text-base font-bold tracking-[0.05em] lg:h-9";

/** Reset's look: lit amber with something to clear, dimmed and disabled without. */
export const resetLook = (lit: boolean) => (lit ? "border-lamp bg-lamp text-plate-ink hover:brightness-105" : "border-board-line text-board-muted opacity-50");

export const ResetIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.5V7h3.5" /></svg>
);

const UndoIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 5 4 8.5 7.5 12" /><path d="M4 8.5h8a4 4 0 0 1 0 8h-2" /></svg>
);

/** Undo or Reset on the board header. Below `sm` (the Lab's phone header) it is a 44px icon square; the label stays for screen readers. */
export function BoardButton({ kind, onClick, disabled, children }: { kind: "undo" | "reset"; onClick: () => void; disabled: boolean; children?: ReactNode }) {
  const look = kind === "reset" ? resetLook(!disabled) : "border-board-line text-white hover:border-board-muted disabled:text-board-muted disabled:opacity-50";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BOARD_ACTION} max-sm:min-w-11 max-sm:px-0 ${look}`}>
      {kind === "reset" ? <ResetIcon /> : <UndoIcon />}
      <span className="max-sm:sr-only">{children ?? (kind === "reset" ? "Reset" : "Undo")}</span>
    </button>
  );
}
