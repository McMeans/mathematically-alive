// The site's share image, for the home page and any page without its own: the mark, the name and what it does.
import { ImageResponse } from "next/og";
import { LAMP, MUTED, READING, frame, imageOptions, logo } from "./og";

export { contentType, size } from "./og";
export const alt = "Mathematically Alive: every path to the playoff, for every team";

export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ ...frame, justifyContent: "center", alignItems: "center", padding: "56px 80px" }}>
        <img src={logo} width={180} height={180} alt="" />
        <div style={{ display: "flex", fontSize: 110, fontWeight: 800, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 1, lineHeight: 1, whiteSpace: "nowrap", marginTop: 18 }}>Mathematically Alive</div>
        <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: LAMP, textTransform: "uppercase", letterSpacing: 1, marginTop: 14 }}>Every path to the playoff, for every team.</div>
        <div style={{ display: "flex", fontFamily: READING, fontSize: 28, color: MUTED, marginTop: 30 }}>Pick a college football team. See what has to happen.</div>
      </div>
    ),
    await imageOptions(),
  );
}
