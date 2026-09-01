/**
 * Verrou local — permet à un agent déjà connecté au moins une fois en ligne
 * sur cet appareil de se RECONNECTER hors-ligne (après une déconnexion
 * explicite, ou si le jeton d'accès a expiré) sans attendre le réseau.
 *
 * Même logique que frontend/src/lib/verrouLocal.ts (Web Admin) — voir ce
 * fichier pour le détail du compromis de sécurité assumé : jamais le mot de
 * passe en clair, une empreinte PBKDF2-SHA256 (100 000 itérations, sel
 * aléatoire par compte) dérivée après chaque connexion réussie EN LIGNE.
 *
 * Stocké PAR COMPTE (dictionnaire indexé par email), pas comme un verrou
 * unique global — corrigé après un bug réel constaté en production : un
 * second compte se connectant en ligne sur le même appareil écrasait
 * silencieusement le verrou du premier compte, rendant sa reconnexion
 * hors-ligne impossible ensuite.
 */

const CLE_VERROUS = 'ppb.verrous_locaux';
const ITERATIONS = 100_000;

interface EmpreinteCompte {
  sel: string;
  hash: string;
}

type TableVerrous = Record<string, EmpreinteCompte>; // clé = email normalisé

function bufVersHex(buf: ArrayBuffer | Uint8Array): string {
  const octets = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(octets)
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('');
}

function hexVersOctets(hex: string): Uint8Array {
  const sortie = new Uint8Array(hex.length / 2);
  for (let i = 0; i < sortie.length; i++) sortie[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return sortie;
}

function lireTable(): TableVerrous {
  try {
    const brut = localStorage.getItem(CLE_VERROUS);
    return brut ? (JSON.parse(brut) as TableVerrous) : {};
  } catch {
    return {};
  }
}

function ecrireTable(table: TableVerrous): void {
  localStorage.setItem(CLE_VERROUS, JSON.stringify(table));
}

async function deriverEmpreinte(motDePasse: string, sel: Uint8Array): Promise<string> {
  const encodeur = new TextEncoder();
  const cleBase = await crypto.subtle.importKey('raw', encodeur.encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    // `as BufferSource` : désaccord de typage TypeScript connu, sans impact à
    // l'exécution.
    { name: 'PBKDF2', salt: sel as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    cleBase,
    256,
  );
  return bufVersHex(bits);
}

/** À appeler juste après une connexion EN LIGNE réussie — met à jour
 * l'empreinte locale de CE compte, sans affecter les autres comptes déjà
 * enregistrés sur cet appareil. */
export async function enregistrerVerificationLocale(email: string, motDePasse: string): Promise<void> {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriverEmpreinte(motDePasse, sel);
  const table = lireTable();
  table[email.trim().toLowerCase()] = { sel: bufVersHex(sel), hash };
  ecrireTable(table);
}

/** true si l'email + mot de passe fournis correspondent à la dernière
 * connexion en ligne réussie de CE compte sur cet appareil. */
export async function verifierLocalement(email: string, motDePasse: string): Promise<boolean> {
  const table = lireTable();
  const empreinte = table[email.trim().toLowerCase()];
  if (!empreinte) return false;
  const hash = await deriverEmpreinte(motDePasse, hexVersOctets(empreinte.sel));
  return hash === empreinte.hash;
}

/** Retire uniquement l'empreinte de CE compte. */
export function effacerVerrouLocal(email: string): void {
  const table = lireTable();
  delete table[email.trim().toLowerCase()];
  ecrireTable(table);
}

/** true si UNE empreinte existe pour cet email (peu importe le mot de
 * passe) — distingue "jamais connecté ici" de "mot de passe incorrect". */
export function aUnVerrouPour(email: string): boolean {
  const table = lireTable();
  return email.trim().toLowerCase() in table;
}

/** Efface TOUS les comptes enregistrés sur cet appareil — réservé à la
 * purge complète (appareil qui change de main), jamais à une simple
 * déconnexion. */
export function effacerTousLesVerrous(): void {
  localStorage.removeItem(CLE_VERROUS);
}
