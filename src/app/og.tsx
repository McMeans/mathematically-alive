// Pieces every share image uses: the board's colours, the brand's fonts, the mark, team logos and the top line.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The site's fonts, as static .woff files (ImageResponse can't read the site's woff2 web fonts): Saira Condensed for
// board lettering and every number, Public Sans for reading. From Fontsource, under the SIL Open Font License
// (OFL-*.txt beside them). Read from the project folder, as Next's docs do; next.config.ts traces the folder into the
// server functions that draw shared Lab links.
export const DISPLAY = "Saira Condensed", READING = "Public Sans";
const font = (file: string, name: string, weight: 400 | 600 | 700 | 800) =>
  readFile(join(process.cwd(), "src/app/fonts", file)).then((data) => ({ name, data, weight, style: "normal" as const }));
const readFonts = () => Promise.all([
  font("saira-condensed-600.woff", DISPLAY, 600),
  font("saira-condensed-700.woff", DISPLAY, 700),
  font("saira-condensed-800.woff", DISPLAY, 800),
  font("public-sans-400.woff", READING, 400),
  font("public-sans-600.woff", READING, 600),
]);
// Read once and kept, but a failed read is dropped, so the next image tries again instead of every image failing
// until the server restarts.
let loaded: ReturnType<typeof readFonts> | null = null;
function fonts() {
  loaded ??= readFonts().catch((e: unknown) => {
    loaded = null;
    throw e;
  });
  return loaded;
}

/** ImageResponse options for a share image: its size and the brand's fonts. */
export async function imageOptions(dims: { width: number; height: number } = { width: 1200, height: 630 }) {
  return { ...dims, fonts: await fonts() };
}

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// public/logo.svg, inline (a server function may not ship the public folder), recoloured for the board: a cream ball
// with a board-green pulse, like the site bar's mark.
export const logo = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 140 140\" role=\"img\" aria-label=\"Mathematically Alive\"><g transform=\"rotate(-30 70 70)\"><path d=\"M8 70 Q70 2 132 70 Q70 138 8 70 Z\" fill=\"#F3F0E6\"/><path d=\"M22 54 Q24 70 22 86 M118 54 Q116 70 118 86\" fill=\"none\" stroke=\"#133F2E\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\"0.9\"/><path d=\"M34 70 H54 L60 57 L68 86 L76 48 L83 70 H106\" fill=\"none\" stroke=\"#133F2E\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M40 63 V77 M47 63 V77 M90 63 V77 M98 63 V77\" stroke=\"#133F2E\" stroke-width=\"4\" stroke-linecap=\"round\"/></g></svg>").toString("base64")}`;

// The board's colours (ImageResponse can't use the site's Tailwind tokens).
export const BOARD = "#133F2E", DEEP = "#0C2C20", LINE = "#2A5A46", MUTED = "#9FBCAE", LAMP = "#F2B134", INK = "#121A16", CREAM = "#F3F0E6";

// How long to wait for one logo. At build time it's generous: each worker is also busy simulating other teams, so a
// fast download can still finish late. A shared Lab link is drawn when a chat app asks for its preview, and the app
// won't wait long, so there a slow logo gives up sooner.
const LOGO_TIMEOUT = process.env.NEXT_PHASE === "phase-production-build" ? 15_000 : 4_000;

// Each team logo as a data URI. A slow or missing logo leaves its row without a logo instead of failing the whole
// image, and a failure gets one retry. Callers fetch a card's logos all at once, so a card waits about as long as its
// slowest logo.
export async function logoData(teamId: number, dark = true, px = 64): Promise<string | null> {
  const url = `https://cdn.collegefootballdata.com/${dark ? "logos-dark" : "logos"}/${px}/${teamId}.png`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT) });
      if (res.status === 404) return null;
      if (!res.ok) continue;
      return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch {
      // timed out or failed: try once more
    }
  }
  return null;
}

/** The card's top line: the mark, the site's name, and what the card is with the data's date ("Season Lab · Through Nov 14"). */
export const masthead = (right: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
    <img src={logo} width={52} height={52} alt="" />
    <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "#F3F0E6", textTransform: "uppercase", letterSpacing: 1 }}>Mathematically Alive</div>
    <div style={{ display: "flex", marginLeft: "auto", fontFamily: READING, fontSize: 24, color: MUTED }}>{right}</div>
  </div>
);

// The board's dot texture (`.board-dots` in globals.css), as a repeating SVG tile: ImageResponse drops the site's
// 1px radial gradient. A touch stronger than the site's 3.5%, since a card is mostly seen scaled down in a chat.
const dot = `url("data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='6' height='6'><circle cx='3' cy='3' r='1.1' fill='#FFFFFF' fill-opacity='0.07'/></svg>").toString("base64")}")`;

export const frame = {
  display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "32px 56px", fontFamily: DISPLAY,
  backgroundColor: BOARD, backgroundImage: dot, backgroundSize: "6px 6px", backgroundRepeat: "repeat",
} as const;

