import Link from "next/link";

/**
 * The last lines of a page's last column: how the numbers are made, where the data comes from, and who we're not.
 * How it works itself leaves out the link to itself.
 */
export function Colophon({ onAbout = false }: { onAbout?: boolean }) {
  const link = "underline decoration-ink-muted/50 underline-offset-2 hover:text-ink hover:decoration-ink-muted";
  return (
    <p className="mt-3 text-xs text-ink-muted">
      {!onAbout && (
        <>
          <Link href="/about" className={link}>How it works</Link>
          {" · "}
        </>
      )}
      Data from{" "}
      <a href="https://collegefootballdata.com" className={link} target="_blank" rel="noopener noreferrer">CollegeFootballData</a>
      . Not affiliated with the College Football Playoff or the NCAA.
    </p>
  );
}
