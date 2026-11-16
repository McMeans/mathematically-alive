// The Season Lab's share image: the projected field by seed and the title favourite, from `labCard`.
import { ImageResponse } from "next/og";
import type { LabCard, LabCardGame, LabCardSlot } from "@/core";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Season Lab: the projected College Football Playoff field";

// public/logo.svg, inline (a server function may not ship the public folder), recoloured for the board: a cream ball
// with a board-green pulse, like the site bar's mark.
const logo = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 140 140\" role=\"img\" aria-label=\"Mathematically Alive\"><g transform=\"rotate(-30 70 70)\"><path d=\"M8 70 Q70 2 132 70 Q70 138 8 70 Z\" fill=\"#F3F0E6\"/><path d=\"M22 54 Q24 70 22 86 M118 54 Q116 70 118 86\" fill=\"none\" stroke=\"#133F2E\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\"0.9\"/><path d=\"M34 70 H54 L60 57 L68 86 L76 48 L83 70 H106\" fill=\"none\" stroke=\"#133F2E\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M40 63 V77 M47 63 V77 M90 63 V77 M98 63 V77\" stroke=\"#133F2E\" stroke-width=\"4\" stroke-linecap=\"round\"/></g></svg>").toString("base64")}`;

// The board's colours (ImageResponse can't use the site's Tailwind tokens). The brand's Saira Condensed isn't loaded
// here: the default sans, bold and tightly spaced, stands in.
const BOARD = "#133F2E", DEEP = "#0C2C20", LINE = "#2A5A46", MUTED = "#9FBCAE", LAMP = "#F2B134", INK = "#121A16";

// Each team logo as a data URI, fetched here with a short timeout so one slow or missing logo leaves its row
// without a logo instead of failing the whole image.
async function logoData(teamId: number, dark = true): Promise<string | null> {
  try {
    const res = await fetch(`https://cdn.collegefootballdata.com/${dark ? "logos-dark" : "logos"}/64/${teamId}.png`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The card's top line: the mark, the site's name, and the data's date. */
const masthead = (through: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
    <img src={logo} width={52} height={52} alt="" />
    <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#F3F0E6", textTransform: "uppercase", letterSpacing: 2 }}>Mathematically Alive</div>
    <div style={{ display: "flex", marginLeft: "auto", fontSize: 24, color: MUTED }}>Season Lab · {through}</div>
  </div>
);

const frame = {
  display: "flex", flexDirection: "column", width: "100%", height: "100%", background: BOARD, padding: "32px 56px", fontFamily: "sans-serif",
  backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.2px)", backgroundSize: "6px 6px",
} as const;

/**
 * The games by round, each round in the order that sets every game level with the games feeding it: walked from the
 * final, a game's feeders in the order of its sides. Round names in play order.
 */
function columns(games: LabCardGame[]): LabCardGame[][] {
  const byIndex = new Map(games.map((g) => [g.index, g]));
  const rounds = new Map<string, LabCardGame[]>();
  for (const g of games) if (!rounds.has(g.round)) rounds.set(g.round, []);
  const walk = (g: LabCardGame) => {
    rounds.get(g.round)!.push(g);
    for (const f of g.feeders) walk(byIndex.get(f)!);
  };
  walk(games[games.length - 1]);
  return [...rounds.values()];
}

/** A filled-in bracket: a column per round, the pick in amber, then my champion. */
async function bracketImage(card: LabCard, through: string): Promise<ImageResponse> {
  const b = card.bracket!;
  const teams = new Map<number, LabCardSlot>();
  for (const g of b.games) for (const s of [g.a, g.b]) if (s) teams.set(s.teamId, s);
  const winners = new Set(b.games.flatMap((g) => (g.winner !== null ? [g.winner] : [])));
  const [dark, light] = await Promise.all([
    Promise.all([...teams.keys()].map(async (id) => [id, await logoData(id)] as const)).then((x) => new Map(x)),
    Promise.all([...winners].map(async (id) => [id, await logoData(id, false)] as const)).then((x) => new Map(x)),
  ]);
  const cols = columns(b.games);
  const slot = (s: LabCardSlot | null, g: LabCardGame) => {
    const on = s !== null && g.winner === s.teamId;
    const off = s !== null && g.winner !== null && !on;
    const src = s && (on ? light.get(s.teamId) : dark.get(s.teamId));
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 10px", borderRadius: 3,
        background: on ? LAMP : s ? DEEP : "transparent", border: s ? "none" : `1px dashed ${LINE}`, opacity: off ? 0.45 : 1,
      }}>
        {s && <div style={{ display: "flex", width: 22, justifyContent: "center", fontSize: 18, fontWeight: 700, color: on ? INK : MUTED }}>{s.seed}</div>}
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
        {s && (src ? <img src={src} width={24} height={24} alt="" /> : <div style={{ display: "flex", width: 24 }} />)}
        {s && <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: on ? INK : "#FFFFFF", textTransform: "uppercase", whiteSpace: "nowrap" }}>{s.abbr}</div>}
      </div>
    );
  };
  const champ = b.champion;
  return new ImageResponse(
    (
      <div style={frame}>
        {masthead(through)}
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 14 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 1 }}>{card.heading}</div>
          <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{b.picked}</div>
        </div>
        <div style={{ display: "flex", flex: 1, gap: 14, marginTop: 14 }}>
          {cols.map((games) => (
            <div key={games[0].round} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", fontSize: 16, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{games[0].round}</div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", flex: 1 }}>
                {games.map((g) => (
                  <div key={g.index} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {slot(g.a, g)}
                    {slot(g.b, g)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", flex: 1.15, justifyContent: "center", alignItems: "center", gap: 10, borderLeft: `1px solid ${LINE}`, paddingLeft: 14 }}>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1.5 }}>{champ ? "My champion" : "No champion yet"}</div>
            {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
            {champ && dark.get(champ.teamId) && <img src={dark.get(champ.teamId)!} width={96} height={96} alt="" />}
            <div style={{ display: "flex", textAlign: "center", fontSize: champ ? 34 : 22, fontWeight: 700, color: champ ? LAMP : "#D7E4DC", textTransform: champ ? "uppercase" : "none", lineHeight: 1.1 }}>
              {champ ? champ.name : card.champion}
            </div>
            {champ && <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{`Seed ${champ.seed}`}</div>}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

export async function cardImage(card: LabCard | null, through: string): Promise<ImageResponse> {
  if (card?.bracket) return bracketImage(card, through);
  const field = card?.field ?? [];
  const logos = new Map(await Promise.all(field.map(async (s) => [s.teamId, await logoData(s.teamId)] as const)));
  const half = Math.ceil(field.length / 2);
  const column = (seeds: LabCard["field"]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
      {seeds.map((s) => (
        <div key={s.seed} style={{ display: "flex", alignItems: "center", gap: 14, height: 48, padding: "0 16px", background: DEEP, borderRadius: 3 }}>
          <div style={{ display: "flex", width: 36, justifyContent: "center", fontSize: 32, fontWeight: 700, color: s.seed <= 4 ? LAMP : MUTED }}>{s.seed}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
          {logos.get(s.teamId) ? <img src={logos.get(s.teamId)!} width={36} height={36} alt="" /> : <div style={{ display: "flex", width: 36, flexShrink: 0 }} />}
          <div style={{ display: "block", flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: -0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
          {s.tag && <div style={{ display: "flex", flexShrink: 0, padding: "2px 8px", border: `1px solid ${MUTED}`, borderRadius: 2, fontSize: 16, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>{s.tag}</div>}
        </div>
      ))}
    </div>
  );
  return new ImageResponse(
    (
      <div style={frame}>
        {masthead(through)}
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 18 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 1 }}>{card?.heading ?? "Season Lab"}</div>
          {card && <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{card.picks}</div>}
        </div>
        {!card && (
          <div style={{ display: "flex", flex: 1, fontSize: 34, color: "#D7E4DC", marginTop: 12 }}>
            Pick any game left and watch the playoff field, bracket and ranking follow.
          </div>
        )}
        <div style={{ display: card ? "flex" : "none", gap: 24, marginTop: 16, flex: 1 }}>
          {column(field.slice(0, half))}
          {column(field.slice(half))}
        </div>
        {card && (
          <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 14, borderRadius: 3, background: LAMP, color: INK, fontSize: 28, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, padding: "8px 22px" }}>
            {card.champion}
          </div>
        )}
      </div>
    ),
    size,
  );
}
