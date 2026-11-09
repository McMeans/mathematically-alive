"use client";
import { useEffect } from "react";

/** Sends a visitor straight on; link previews read the page's tags without running it. */
export function Forward({ to }: { to: string }) {
  useEffect(() => window.location.replace(to), [to]);
  return null;
}
