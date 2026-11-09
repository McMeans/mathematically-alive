// The share image for a Lab link's picks.
import { notFound } from "next/navigation";
import { through } from "@/app/dates";
import { cardImage } from "../../card";
import { sharedCard } from "./shared";

export { alt, contentType, size } from "../../card";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const card = sharedCard((await params).code);
  if (card === undefined) notFound();
  return cardImage(card, through);
}
