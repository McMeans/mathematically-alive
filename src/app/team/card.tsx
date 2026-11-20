// A team page's share image: the team, its record, and the header's odds (playoff, title game, conference title),
// worded by the same core functions as the page, so a shared link previews what the page opens on.
import { ImageResponse } from "next/og";
import { INDEPENDENTS, conferenceShort, formatChampion, formatPlayoff, formatRecord, formatTitleOdds, liveRanks, oddsLabels } from "@/core";
import { CREAM, DEEP, INK, LAMP, MUTED, READING, frame, imageOptions, logoData, masthead } from "@/app/og";
import { baseExplore, baseExploreIndependent, conferenceOf, season, through } from "@/app/season";

type Score = { label: string; value: string };

// The live ranking, as the page header shows it ("#19"): the committee's latest ranking, moved by results since.
const ranks = liveRanks(season);

/** The header's numbers for a team with a page, as the page shows them with no picks; null for any other team. */
export function teamScores(teamId: number): { name: string; rank: string | null; record: string; scores: Score[] } | null {
  const conference = conferenceOf(teamId);
  const team = season.teams.find((t) => t.id === teamId);
  if (conference === null || !team) return null;
  if (conference === INDEPENDENTS) {
    const me = baseExploreIndependent(teamId).outlook.find((o) => o.teamId === teamId)!;
    return {
      name: team.name, rank: ranks[teamId] ?? null, record: formatRecord(me.record, conference),
      scores: [{ label: "Playoff*", value: formatPlayoff(me.playoff, me.cfp, "alive", false, me.postseasonBan) }],
    };
  }
  const me = baseExplore(teamId, conference).outlook.find((o) => o.teamId === teamId)!;
  const labels = oddsLabels(conference);
  return {
    name: team.name, rank: ranks[teamId] ?? null, record: formatRecord(me.record, conference),
    scores: [
      { label: `${labels.playoff}*`, value: formatPlayoff(me.playoff, me.cfp, me.status, me.autoBid, me.postseasonBan) },
      { label: `${conferenceShort(conference)} title game`, value: formatTitleOdds(me.titleGame, me.status) },
      { label: labels.champion, value: formatChampion(me) },
    ],
  };
}

export async function teamImage(teamId: number): Promise<ImageResponse | null> {
  const t = teamScores(teamId);
  if (!t) return null;
  const logo = await logoData(teamId, true, 128);
  return new ImageResponse(
    (
      <div style={frame}>
        {masthead(through)}
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 48 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img only */}
          {logo ? <img src={logo} width={128} height={128} alt="" /> : <div style={{ display: "flex", width: 128 }} />}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", fontSize: (t.rank ?? "").length + t.name.length > 20 ? 76 : 92, fontWeight: 800, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 0.5, lineHeight: 1, whiteSpace: "nowrap", maxWidth: 900 }}>
              {t.rank && <span style={{ color: CREAM, marginRight: 18 }}>{t.rank}</span>}{t.name}
            </div>
            <div style={{ display: "flex", fontFamily: READING, fontSize: 30, color: MUTED, marginTop: 8 }}>{t.record}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 44 }}>
          {t.scores.map((s) => (
            // A tile is lit only when it's settled In: amber means the lit thing, and nothing else on the card is.
            // A lone tile (an independent's playoff odds) keeps a three-tile width rather than stretching across the card.
            <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: t.scores.length === 1 ? "0 0 349px" : 1, padding: "18px 26px", background: DEEP, borderRadius: 3, borderTop: `4px solid ${s.value === "In" ? LAMP : "transparent"}` }}>
              <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1.5 }}>{s.label}</div>
              <div style={{ display: "flex", fontSize: 100, fontWeight: 800, color: "#FFFFFF", lineHeight: 1, marginTop: 6 }}>{s.value}</div>
            </div>
          ))}
          {t.scores.length === 1 && (
            <div style={{ display: "flex", fontFamily: READING, fontSize: 28, color: MUTED, marginLeft: 16, maxWidth: 560 }}>Independent: no conference title game, so playoff odds only.</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: "auto", gap: 16 }}>
          <div style={{ display: "flex", padding: "6px 16px", background: CREAM, color: INK, fontSize: 28, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, borderRadius: 3 }}>Every path to the playoff</div>
          <div style={{ display: "flex", fontFamily: READING, fontSize: 22, color: MUTED }}>*Our model, not the committee.</div>
        </div>
      </div>
    ),
    await imageOptions(),
  );
}
