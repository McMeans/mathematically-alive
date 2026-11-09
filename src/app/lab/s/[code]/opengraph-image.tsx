// The share image for a Lab link's picks.
import { cardImage } from "../../card";
import { sharedCard, through } from "./shared";

export { alt, contentType, size } from "../../card";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  return cardImage(sharedCard((await params).code), through);
}
