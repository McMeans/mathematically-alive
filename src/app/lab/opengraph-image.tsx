// The share image for the Lab with no picks, built once.
import { labCard } from "@/core";
import { baseLab, season, through } from "@/app/season";
import { cardImage } from "./card";

export { alt, contentType, size } from "./card";

export default function Image() {
  return cardImage(labCard(season, baseLab), through);
}
