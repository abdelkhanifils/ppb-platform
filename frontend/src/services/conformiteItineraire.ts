import type { ItineraireVerificationApi } from "@/types/controle";

/**
 * Reproduit EXACTEMENT la logique de conformité du backend (voir
 * backend/app/api/v1/endpoints/controles.py::enregistrer_controle) pour un
 * résultat immédiat côté terrain, hors-ligne — sans jamais se substituer à
 * l'enregistrement serveur, qui reste la source de vérité dès que la
 * connexion est rétablie (voir db/queueControle.ts).
 *
 * Simplification documentée côté backend, reproduite ici à l'identique : sans
 * référentiel des postes, la conformité vérifie que le pays de l'agent fait
 * partie du trajet déclaré (origine OU destination) — pas la position exacte
 * sur ce trajet.
 *
 * Retourne `null` si l'itinéraire n'est pas disponible localement (page 3 pas
 * encore synchronisée) — c'est le cas « à vérifier » : repli sur le document
 * papier, jamais un blocage ni une validation par défaut.
 */
export function verifierConformiteItineraire(
  paysAgentId: number | null,
  itineraire: ItineraireVerificationApi | undefined
): boolean | null {
  if (!itineraire || paysAgentId === null) return null;
  return paysAgentId === itineraire.pays_origine_id || paysAgentId === itineraire.pays_destination_id;
}
