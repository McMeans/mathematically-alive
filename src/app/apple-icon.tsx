// The home-screen icon for iPhones and iPads (they don't use the SVG favicon): the board-green ball with a cream
// pulse, as in icon.svg, on the cream plate.
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const mark = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 140 140\"><g transform=\"rotate(-30 70 70)\"><path d=\"M8 70 Q70 2 132 70 Q70 138 8 70 Z\" fill=\"#133F2E\"/><path d=\"M30 70 H54 L62 50 L76 90 L84 70 H110\" fill=\"none\" stroke=\"#F3F0E6\" stroke-width=\"14\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g></svg>").toString("base64")}`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#F3F0E6" }}>
        <img src={mark} width={150} height={150} alt="" />
      </div>
    ),
    size,
  );
}
