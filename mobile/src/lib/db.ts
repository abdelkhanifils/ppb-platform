/**
 * Stockage local — le cœur du fonctionnement hors connexion.
 *
 * IndexedDB porte les données volumineuses ou nombreuses (cache des
 * passeports vierges, émissions, photos en Blob). La session agent et les
 * réglages restent dans `localStorage` : ils doivent être lus de façon
 * synchrone au tout premier rendu, avant qu'une transaction asynchrone ait
 * pu aboutir.
 *
 * Les formes de données (`DonneesPage3`, `DonneesPage4`, ...) sont le miroir
 * exact des schémas du backend existant. Toute divergence casserait
 * silencieusement la synchronisation : elles ne doivent évoluer qu'avec lui.
 */
import { openDB, type IDBPDatabase } from 'idb';

/* ------------------------------------------------------------------ */
/* Référentiel CEMAC — figé par traité, disponible dès le 1er lancement */
/* ------------------------------------------------------------------ */

export interface PaysReference {
  id: number;
  code_iso: string;
  code_numerique: string;
  nom: string;
}

export const PAYS_CEMAC: PaysReference[] = [
  { id: 1, code_iso: 'CMR', code_numerique: '01', nom: 'Cameroun' },
  { id: 2, code_iso: 'CAF', code_numerique: '02', nom: 'Centrafrique' },
  { id: 3, code_iso: 'COG', code_numerique: '03', nom: 'Congo' },
  { id: 4, code_iso: 'GAB', code_numerique: '04', nom: 'Gabon' },
  { id: 5, code_iso: 'GNQ', code_numerique: '05', nom: 'Guinée Équatoriale' },
  { id: 6, code_iso: 'TCD', code_numerique: '06', nom: 'Tchad' },
];

/* ------------------------------------------------------------------ */
/* Formes de données alignées sur le backend                          */
/* ------------------------------------------------------------------ */

export interface PasseportCache {
  id: string;
  qr_uuid: string;
  numero: string;
}

export interface DonneesPersonne {
  nom_prenom: string;
  numero_cni: string;
  telephone?: string;
  donnees_dynamiques: Record<string, string | number | boolean | undefined>;
}

export interface DonneesItineraire {
  pays_origine_id: number;
  province_origine: string;
  localite_origine?: string;
  pays_destination_id: number;
  province_destination: string;
  localite_destination?: string;
}

export interface DonneesPage3 {
  eleveur: DonneesPersonne;
  convoyeur: DonneesPersonne;
  itineraire: DonneesItineraire;
}

export type EspeceTroupeau = 'bovin' | 'ovin' | 'caprin' | 'camelin' | 'autre';

export interface EffectifEspece {
  espece: EspeceTroupeau;
  nombre_males: number;
  nombre_femelles_jeunes: number;
  nombre_femelles_adultes: number;
  nombre_total: number;
}

export type MaladieControlee =
  | 'peste_petits_ruminants'
  | 'peripneumonie_contagieuse'
  | 'charbon'
  | 'trypanosomiase';

export const MALADIES_CONTROLEES: MaladieControlee[] = [
  'peste_petits_ruminants',
  'peripneumonie_contagieuse',
  'charbon',
  'trypanosomiase',
];

export const ESPECES_PASSEPORT: EspeceTroupeau[] = ['bovin', 'ovin', 'caprin', 'camelin'];

export interface DonneesVaccination {
  maladie: MaladieControlee;
  date_vaccination: string | null;
  lieu: string | null;
}

export interface DonneesPage4 {
  especes: EffectifEspece[];
  vaccinations: DonneesVaccination[];
  donnees_dynamiques?: Record<string, string | number | boolean | undefined>;
}

/* ------------------------------------------------------------------ */
/* Émission locale                                                     */
/* ------------------------------------------------------------------ */

export type EtatSynchro = 'en_attente' | 'en_cours' | 'synchronisee' | 'erreur';

export interface PositionGps {
  latitude: number;
  longitude: number;
  precision_m: number;
}

export interface Emission {
  id: string;
  passeport_id: string;
  qr_uuid: string;
  numero: string;
  page3: DonneesPage3;
  page4: DonneesPage4;
  photo_page3?: Blob;
  photo_page4?: Blob;
  gps: PositionGps | null;
  cree_le: string;
  agent_email: string;
  etat_synchro: EtatSynchro;
  pages_envoyees: number[];
  photos_envoyees: number[];
  tentatives: number;
  derniere_erreur: string | null;
  statut_serveur: string | null;
}

export interface SessionAgent {
  access_token: string;
  refresh_token: string;
  email: string;
  role: string | null;
  pays_id: number | null;
  poste: string | null;
  connecte_le: string;
}

/* ------------------------------------------------------------------ */
/* Session (localStorage — lecture synchrone au démarrage)             */
/* ------------------------------------------------------------------ */

const CLE_SESSION = 'ppb.session';

export function lireSession(): SessionAgent | null {
  try {
    const brut = localStorage.getItem(CLE_SESSION);
    return brut ? (JSON.parse(brut) as SessionAgent) : null;
  } catch {
    return null;
  }
}

export function ecrireSession(session: SessionAgent): void {
  localStorage.setItem(CLE_SESSION, JSON.stringify(session));
}

export function effacerSession(): void {
  localStorage.removeItem(CLE_SESSION);
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

const NOM_BASE = 'ppb-emission';
const VERSION_BASE = 1;

let promesseBase: Promise<IDBPDatabase> | null = null;

function base(): Promise<IDBPDatabase> {
  if (!promesseBase) {
    promesseBase = openDB(NOM_BASE, VERSION_BASE, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('passeports')) {
          db.createObjectStore('passeports', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('emissions')) {
          const magasin = db.createObjectStore('emissions', { keyPath: 'id' });
          magasin.createIndex('etat_synchro', 'etat_synchro');
          magasin.createIndex('passeport_id', 'passeport_id', { unique: true });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
    });
  }
  return promesseBase;
}

export async function enregistrerCachePasseports(liste: PasseportCache[]): Promise<void> {
  const db = await base();
  const tx = db.transaction('passeports', 'readwrite');
  // Le serveur ne renvoie que les passeports encore VIERGES : on remplace le
  // cache au lieu de le compléter, sinon un passeport émis ailleurs resterait
  // proposé indéfiniment sur cet appareil.
  await tx.objectStore('passeports').clear();
  for (const passeport of liste) {
    await tx.objectStore('passeports').put(passeport);
  }
  await tx.done;
  await definirMeta('derniere_synchro_cache', new Date().toISOString());
}

export async function listerPasseportsCache(): Promise<PasseportCache[]> {
  const db = await base();
  return (await db.getAll('passeports')) as PasseportCache[];
}

/** Passeports encore réellement disponibles : le cache serveur moins ceux déjà émis depuis cet appareil. */
export async function listerPasseportsDisponibles(): Promise<PasseportCache[]> {
  const [cache, emissions] = await Promise.all([listerPasseportsCache(), listerEmissions()]);
  const consommes = new Set(emissions.map((e) => e.passeport_id));
  return cache.filter((p) => !consommes.has(p.id)).sort((a, b) => a.numero.localeCompare(b.numero));
}

export async function listerEmissions(): Promise<Emission[]> {
  const db = await base();
  const liste = (await db.getAll('emissions')) as Emission[];
  return liste.sort((a, b) => b.cree_le.localeCompare(a.cree_le));
}

export async function enregistrerEmission(emission: Emission): Promise<void> {
  const db = await base();
  await db.put('emissions', emission);
}

export async function lireEmission(id: string): Promise<Emission | undefined> {
  const db = await base();
  return (await db.get('emissions', id)) as Emission | undefined;
}

export async function emissionParPasseport(passeportId: string): Promise<Emission | undefined> {
  const db = await base();
  return (await db.getFromIndex('emissions', 'passeport_id', passeportId)) as Emission | undefined;
}

export async function definirMeta(cle: string, valeur: unknown): Promise<void> {
  const db = await base();
  await db.put('meta', valeur, cle);
}

export async function lireMeta<T>(cle: string): Promise<T | undefined> {
  const db = await base();
  return (await db.get('meta', cle)) as T | undefined;
}

/** Purge complète — déconnexion sur un appareil qui change de main. */
export async function purgerDonneesLocales(): Promise<void> {
  const db = await base();
  const tx = db.transaction(['passeports', 'emissions', 'meta'], 'readwrite');
  await tx.objectStore('passeports').clear();
  await tx.objectStore('emissions').clear();
  await tx.objectStore('meta').clear();
  await tx.done;
  effacerSession();
}

/* ------------------------------------------------------------------ */
/* Fabriques de données vierges                                        */
/* ------------------------------------------------------------------ */

export function personneVide(): DonneesPersonne {
  return { nom_prenom: '', numero_cni: '', telephone: '', donnees_dynamiques: {} };
}

export function page3Vide(paysAgent: number | null): DonneesPage3 {
  const pays = paysAgent ?? PAYS_CEMAC[0].id;
  return {
    eleveur: personneVide(),
    convoyeur: personneVide(),
    itineraire: {
      pays_origine_id: pays,
      province_origine: '',
      localite_origine: '',
      pays_destination_id: pays,
      province_destination: '',
      localite_destination: '',
    },
  };
}

export function page4Vide(): DonneesPage4 {
  return {
    especes: ESPECES_PASSEPORT.map((espece) => ({
      espece,
      nombre_males: 0,
      nombre_femelles_jeunes: 0,
      nombre_femelles_adultes: 0,
      nombre_total: 0,
    })),
    vaccinations: MALADIES_CONTROLEES.map((maladie) => ({
      maladie,
      date_vaccination: null,
      lieu: null,
    })),
  };
}

export function identifiantLocal(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `loc-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}