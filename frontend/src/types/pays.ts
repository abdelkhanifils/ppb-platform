// Référentiel des 6 États membres CEMAC — miroir de app/db/seed.py côté
// backend. Gardé en dur ici (plutôt qu'un appel réseau) car cette liste est
// fixée par le traité CEMAC et doit rester disponible hors-ligne dès le
// premier lancement de l'app, sans dépendre d'un premier accès réseau.
// Les identifiants numériques (id) doivent correspondre à ceux amorcés en
// base ; à resynchroniser manuellement si le seed change.
export interface PaysReference {
  id: number;
  code_iso: string;
  code_numerique: string;
  nom: string;
}

export const PAYS_CEMAC: PaysReference[] = [
  { id: 1, code_iso: "CMR", code_numerique: "01", nom: "Cameroun" },
  { id: 2, code_iso: "CAF", code_numerique: "02", nom: "Centrafrique" },
  { id: 3, code_iso: "COG", code_numerique: "03", nom: "Congo" },
  { id: 4, code_iso: "GAB", code_numerique: "04", nom: "Gabon" },
  { id: 5, code_iso: "GNQ", code_numerique: "05", nom: "Guinée Équatoriale" },
  { id: 6, code_iso: "TCD", code_numerique: "06", nom: "Tchad" },
];
