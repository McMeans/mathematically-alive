"use client";
import { useEffect, useState } from "react";

/** The older copy route, for browsers or frames that refuse the clipboard API. */
function copyByHand(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * Shares the page's address, which carries the picks (`?picks=`). Phones get the system share sheet; elsewhere the
 * link is copied. `small` matches the summary column's Reset; otherwise the pinned bar's, with a shorter label to leave room for
 * the team name. `link` overrides the address shared.
 */
export function ShareButton({ small = false, className = "", link, board = false, label }: {
  small?: boolean; className?: string; link?: () => string;
  /** The cream plate on the board header, not the plain button on the ground. */
  board?: boolean;
  label?: string;
}) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 2000);
    return () => clearTimeout(t);
  }, [note]);

  async function share() {
    const url = link?.() ?? window.location.href;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // closed the share sheet
      setNote(copyByHand(url) ? "Link copied" : "Couldn’t copy");
    }
  }

  const look = board
    ? "cond h-9 rounded-[3px] bg-plate px-4 text-base tracking-[0.05em] text-plate-ink hover:bg-white md:h-[38px]"
    : `cond ${small ? "h-9" : "min-h-10"} rounded-[3px] border border-rule bg-white px-3 text-[15px] tracking-[0.05em] text-ink hover:border-ink-muted`;
  return (
    <button
      type="button"
      onClick={share}
      title={note || undefined}
      className={`press flex shrink-0 items-center gap-1.5 font-bold ${look} ${className}`}
    >
      {/* The label keeps its width (the phone bar is tight); only the icon shows the result, and screen readers hear it. */}
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {note === "Link copied" ? <path d="M4.5 10.5l3.5 3.5 7.5-8" /> : note ? <path d="M10 5v6M10 14.5v.5" /> : <><path d="M10 3v10M6 7l4-4 4 4" /><path d="M5 11v4.5A1.5 1.5 0 0 0 6.5 17h7a1.5 1.5 0 0 0 1.5-1.5V11" /></>}
      </svg>
      <span>{label ?? (small ? "Share picks" : "Share")}</span>
      <span aria-live="polite" className="sr-only">{note}</span>
    </button>
  );
}
