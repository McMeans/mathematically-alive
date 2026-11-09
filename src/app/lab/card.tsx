// The Season Lab's share image: the projected field by seed and the title favourite, from `labCard`.
import { ImageResponse } from "next/og";
import type { LabCard } from "@/core";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Season Lab: the projected College Football Playoff field";

// public/logo.svg, inline: a server function may not ship the public folder.
const logo = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 140 140\" role=\"img\" aria-label=\"Mathematically Alive\"><g transform=\"rotate(-30 70 70)\"><path d=\"M8 70 Q70 2 132 70 Q70 138 8 70 Z\" fill=\"#14213D\"/><path d=\"M22 54 Q24 70 22 86 M118 54 Q116 70 118 86\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\"0.9\"/><path d=\"M34 70 H54 L60 57 L68 86 L76 48 L83 70 H106\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M40 63 V77 M47 63 V77 M90 63 V77 M98 63 V77\" stroke=\"#FFFFFF\" stroke-width=\"4\" stroke-linecap=\"round\"/></g></svg>").toString("base64")}`;
// A team colour too light to read as a chip on white falls back to navy.
const chip = (c: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) && luminance(c) < 0.8 ? c : "#14213D");
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function cardImage(card: LabCard | null, through: string): ImageResponse {
  const field = card?.field ?? [];
  const half = Math.ceil(field.length / 2);
  const column = (seeds: LabCard["field"]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
      {seeds.map((s) => (
        <div key={s.seed} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28 }}>
          <div style={{ display: "flex", width: 44, justifyContent: "flex-end", color: "#5B6478", fontWeight: 700 }}>{s.seed}</div>
          <div style={{ display: "flex", width: 12, height: 32, borderRadius: 3, background: chip(s.color) }} />
          <div style={{ display: "flex", color: "#14213D", fontWeight: 700 }}>{s.name}</div>
        </div>
      ))}
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#FFFFFF", padding: "40px 64px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
          <img src={logo} width={56} height={56} alt="" />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: "#14213D" }}>Mathematically Alive</div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 24, color: "#5B6478" }}>Season Lab · {through}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 24 }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: "#14213D" }}>{card?.heading ?? "Season Lab"}</div>
          {card && <div style={{ display: "flex", fontSize: 26, color: "#3A4458" }}>{card.picks}</div>}
        </div>
        <div style={{ display: "flex", gap: 48, marginTop: 20, flex: 1 }}>
          {column(field.slice(0, half))}
          {column(field.slice(half))}
        </div>
        {card && (
          <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 16, borderRadius: 999, background: "#D9622B", color: "#FFFFFF", fontSize: 28, fontWeight: 700, padding: "10px 24px" }}>
            {card.champion}
          </div>
        )}
      </div>
    ),
    size,
  );
}
