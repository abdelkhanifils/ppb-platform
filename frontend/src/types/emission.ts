// Miroir des schémas backend (voir backend/app/schemas/admin.py et
// backend/app/models/{numerisation,eleveur,convoyeur,troupeau,itineraire,vaccination}.py).
// Toute divergence entre ce fichier et le backend casse silencieusement la
// synchronisation — les deux doivent évoluer ensemble.

export type TypeChamp = "texte" | "nombre" | "date" | "liste" | "booleen";

export interface ChampSchema {
  code_champ: string;
  libelle_fr: string;
  libelle_en: string | null;
  libelle_ar: string | null;
  type_champ: TypeChamp;
  obligatoire: boolean;
  ordre_affichage: number;
  regle_validation: string | null;
  options_liste: { valeurs?: string[] } | null;
}

export interface SchemaFormulaire {
  code: string; // "eleveur" | "convoyeur" | "troupeau"
  schema_version: number;
  champs: ChampSchema[];
}

// --- Passeport préchargé (cache d'émission, GET /passeports/cache-emission) ---

export interface PasseportPrecharge {
  id: string;
  qr_uuid: string;
  numero: string; // "01-2027-0000001"
}

// --- Payloads des 4 pages (POST /numerisations/{passeport_id}/pages/{page_num}) ---
// Page 1 : vérification visuelle uniquement — donnees_json toujours `null`.
// Page 2 : sélection du passeport via QR — donnees_json toujours `null`
//          (le passeport_id de l'URL EST la donnée : rien d'autre à transmettre).
// Page 3 et 4 : ci-dessous. Champs structurels fixes + `donnees_dynamiques`
// pour les champs pilotés par le Super Admin (Module Administration).

export interface DonneesPersonne {
  nom_prenom: string;
  numero_cni: string;
  telephone?: string;
  // `| undefined` : un champ dynamique en cours de saisie (avant validation)
  // peut être momentanément vide — `validerValeursFormulaire` bloque la
  // soumission tant qu'un champ obligatoire reste undefined, mais le type
  // doit rester assignable pendant la frappe.
  donnees_dynamiques: Record<string, string | number | boolean | undefined>;
}

export interface DonneesItineraire {
  // Exactement l'un des deux par sens (origine / destination) — jamais les
  // deux, jamais aucun — voir backend/app/services/emission.py pour la
  // validation faisant foi.
  pays_origine_id: number | null;
  pays_origine_autre: string | null;
  province_origine: string;
  localite_origine?: string;
  pays_destination_id: number | null;
  pays_destination_autre: string | null;
  province_destination: string;
  localite_destination?: string;
}

export interface DonneesPage3 {
  eleveur: DonneesPersonne;
  convoyeur: DonneesPersonne;
  itineraire: DonneesItineraire;
}

export type EspeceTroupeau = "bovin" | "ovin" | "caprin" | "camelin" | "autre";

export interface EffectifEspece {
  espece: EspeceTroupeau;
  nombre_males: number;
  nombre_femelles_jeunes: number;
  nombre_femelles_adultes: number;
  nombre_total: number; // recalculé côté UI, revalidé côté serveur — jamais saisi seul
}

export type MaladieControlee =
  | "peste_petits_ruminants"
  | "peripneumonie_contagieuse"
  | "charbon"
  | "trypanosomiase";

export interface DonneesVaccination {
  maladie: MaladieControlee;
  date_vaccination: string | null; // "AAAA-MM-JJ"
  lieu: string | null;
}

export interface DonneesPage4 {
  especes: EffectifEspece[];
  vaccinations: DonneesVaccination[];
  // Champs dynamiques du formulaire "troupeau" (Module Administration) — le
  // modèle Troupeau ne les persiste pas encore individuellement côté backend
  // (voir backend/app/models/troupeau.py) ; ils voyagent néanmoins dans
  // donnees_json dès maintenant pour ne rien perdre de la saisie terrain,
  // prêts à être exploités dès que ce TODO backend sera levé.
  donnees_dynamiques?: Record<string, string | number | boolean | undefined>;
}

export type DonneesPage = null | DonneesPage3 | DonneesPage4;

export interface StatutNumerisation {
  page_num: 1 | 2 | 3 | 4;
  statut_validation: "en_attente" | "validee";
  statut_sync: "local" | "synchronisee";
}
