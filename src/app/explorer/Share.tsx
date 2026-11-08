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
 * the team name.
 */
export function ShareButton({ small = false, className = "" }: { small?: boolean; className?: string }) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 2000);
    return () => clearTimeout(t);
  }, [note]);

  async function share() {
    const url = window.location.href;
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

  const size = small ? "h-8 text-xs" : "min-h-10 text-sm";
  return (
    <button
      type="button"
      onClick={share}
      className={`press flex ${size} shrink-0 animate-rise items-center gap-1.5 rounded-full border border-ink-muted/40 bg-white px-3 font-bold text-navy hover:bg-mist ${className}`}
    >
      <span aria-hidden>↗</span>
      <span aria-live="polite">{note || (small ? "Share picks" : "Share")}</span>
    </button>
  );
}
