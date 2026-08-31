/**
 * Drapeaux des 6 pays CEMAC — ensemble fixe et restreint (voir
 * backend/app/db/seed.py), une correspondance simple codée en dur est donc
 * plus fiable qu'une bibliothèque générique de conversion ISO. Un drapeau
 * emoji se construit à partir de deux "regional indicator symbols"
 * Unicode — un code à 2 lettres, pas les codes à 3 lettres utilisés par le
 * reste de la plateforme (CMR, CAF, COG, GAB, GNQ, TCD).
 */
const DRAPEAUX_CEMAC: Record<string, string> = {
  CMR: "🇨🇲", // Cameroun
  CAF: "🇨🇫", // Centrafrique
  COG: "🇨🇬", // Congo
  GAB: "🇬🇦", // Gabon
  GNQ: "🇬🇶", // Guinée Équatoriale
  TCD: "🇹🇩", // Tchad
};

/** Renvoie le drapeau emoji pour un code pays à 3 lettres, ou un repli
 * neutre (🏳️) si le code n'est pas reconnu — jamais d'exception, un pays
 * mal configuré ne doit jamais casser l'affichage d'une liste entière. */
export function drapeauPays(codeIso: string | undefined | null): string {
  if (!codeIso) return "🏳️";
  return DRAPEAUX_CEMAC[codeIso.toUpperCase()] ?? "🏳️";
}
