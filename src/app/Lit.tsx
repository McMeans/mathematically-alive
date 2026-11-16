"use client";
import { useState } from "react";

/**
 * A lit number that flips (`.plate-hang`) when its value changes, and only then: not when it first appears (page
 * load, a tab or view switch), so new content rises in without every digit also flipping.
 */
export function Lit({ value, className = "" }: { value: string; className?: string }) {
  // Adjusting state while rendering, when the value changes: each change re-keys the span so the flip runs again.
  const [shown, setShown] = useState({ value, flips: 0 });
  if (shown.value !== value) setShown({ value, flips: shown.flips + 1 });
  return <span key={shown.flips} className={`plate ${shown.flips > 0 ? "plate-hang" : ""} ${className}`}>{value}</span>;
}
