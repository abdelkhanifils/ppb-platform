/**
 * Drapeaux des 6 pays CEMAC — voir frontend/src/lib/drapeaux.ts (même
 * logique, dupliquée ici : les deux applications ne partagent pas de code
 * commun, dupliquer ce petit utilitaire est plus simple qu'un paquet
 * partagé pour six lignes de correspondance fixe).
 */
const DRAPEAUX_CEMAC: Record<string, string> = {
  CMR: '🇨🇲', // Cameroun
  CAF: '🇨🇫', // Centrafrique
  COG: '🇨🇬', // Congo
  GAB: '🇬🇦', // Gabon
  GNQ: '🇬🇶', // Guinée Équatoriale
  TCD: '🇹🇩', // Tchad
};

/** Renvoie le drapeau emoji pour un code pays à 3 lettres, ou un repli
 * neutre (🏳️) si le code n'est pas reconnu. */
export function drapeauPays(codeIso: string | undefined | null): string {
  if (!codeIso) return '🏳️';
  return DRAPEAUX_CEMAC[codeIso.toUpperCase()] ?? '🏳️';
}
