// The Season Lab's share image: the projected field by seed and the title favourite, from `labCard`.
import { ImageResponse } from "next/og";
import type { LabCard } from "@/core";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Season Lab: the projected College Football Playoff field";

// public/logo.svg, inline (a server function may not ship the public folder), recoloured for the board: a cream ball
// with a board-green pulse, like the site bar's mark.
const logo = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 140 140\" role=\"img\" aria-label=\"Mathematically Alive\"><g transform=\"rotate(-30 70 70)\"><path d=\"M8 70 Q70 2 132 70 Q70 138 8 70 Z\" fill=\"#F3F0E6\"/><path d=\"M22 54 Q24 70 22 86 M118 54 Q116 70 118 86\" fill=\"none\" stroke=\"#133F2E\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\"0.9\"/><path d=\"M34 70 H54 L60 57 L68 86 L76 48 L83 70 H106\" fill=\"none\" stroke=\"#133F2E\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M40 63 V77 M47 63 V77 M90 63 V77 M98 63 V77\" stroke=\"#133F2E\" stroke-width=\"4\" stroke-linecap=\"round\"/></g></svg>").toString("base64")}`;

// The board's colours (ImageResponse can't use the site's Tailwind tokens). The brand's Saira Condensed isn't loaded
// here: the default sans, bold and tightly spaced, stands in.
const BOARD = "#133F2E", DEEP = "#0C2C20", MUTED = "#9FBCAE", LAMP = "#F2B134", INK = "#121A16";

export function cardImage(card: LabCard | null, through: string): ImageResponse {
  const field = card?.field ?? [];
  const half = Math.ceil(field.length / 2);
  const column = (seeds: LabCard["field"]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
      {seeds.map((s) => (
        <div key={s.seed} style={{ display: "flex", alignItems: "center", gap: 14, height: 48, padding: "0 16px", background: DEEP, borderRadius: 3 }}>
          <div style={{ display: "flex", width: 36, justifyContent: "center", fontSize: 32, fontWeight: 700, color: s.seed <= 4 ? LAMP : MUTED }}>{s.seed}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
          <img src={`https://cdn.collegefootballdata.com/logos-dark/64/${s.teamId}.png`} width={36} height={36} alt="" />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: -0.3, whiteSpace: "nowrap" }}>{s.name}</div>
          {s.tag && <div style={{ display: "flex", marginLeft: "auto", padding: "2px 8px", border: `1px solid ${MUTED}`, borderRadius: 2, fontSize: 16, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>{s.tag}</div>}
        </div>
      ))}
    </div>
  );
  return new ImageResponse(
    (
      <div style={{
        display: "flex", flexDirection: "column", width: "100%", height: "100%", background: BOARD, padding: "32px 56px", fontFamily: "sans-serif",
        backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.2px)", backgroundSize: "6px 6px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
          <img src={logo} width={52} height={52} alt="" />
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#F3F0E6", textTransform: "uppercase", letterSpacing: 2 }}>Mathematically Alive</div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 24, color: MUTED }}>Season Lab · {through}</div>
        </div>
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
