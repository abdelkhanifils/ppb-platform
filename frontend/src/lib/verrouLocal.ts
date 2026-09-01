/**
 * Verrou local — permet à un agent déjà connecté au moins une fois en ligne
 * sur cet appareil de se RECONNECTER hors-ligne (après une déconnexion
 * explicite, ou si le jeton d'accès a expiré) sans attendre le réseau.
 *
 * Stocké PAR COMPTE (dictionnaire indexé par email), pas comme un verrou
 * unique global — corrigé après un bug réel constaté en production : un
 * second compte se connectant en ligne sur le même appareil (poste
 * partagé, ou simple test avec deux comptes) écrasait silencieusement le
 * verrou du premier compte, rendant sa reconnexion hors-ligne impossible
 * ensuite. Chaque compte qui s'est déjà connecté en ligne au moins une
 * fois sur cet appareil garde désormais sa propre entrée, indéfiniment
 * (jusqu'à un `effacerVerrouLocal(email)` explicite).
 *
 * Principe : jamais le mot de passe en clair. On dérive une empreinte
 * (PBKDF2-SHA256, 100 000 itérations, sel aléatoire par compte — API
 * Web Crypto native du navigateur) juste après chaque connexion RÉUSSIE EN
 * LIGNE, et on la compare localement à la prochaine tentative hors-ligne.
 *
 * Limite assumée, à connaître : ceci protège contre un accès occasionnel
 * (quelqu'un qui trouve l'appareil), pas contre une analyse experte de
 * l'appareil lui-même — un mot de passe très faible reste théoriquement
 * cassable hors-ligne par une personne qui aurait un accès prolongé au
 * stockage local. C'est le même compromis que la plupart des verrous
 * d'écran d'app mobile hors-ligne (gestionnaires de mots de passe compris),
 * pas un chiffrement à vocation de coffre-fort.
 */

const CLE_VERROUS = "ppb_verrous_locaux";
const ITERATIONS = 100_000;

interface EmpreinteCompte {
  sel: string; // hex
  hash: string; // hex
}

type TableVerrous = Record<string, EmpreinteCompte>; // clé = email normalisé

function bufVersHex(buf: ArrayBuffer | Uint8Array): string {
  const octets = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(octets)
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("");
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
  const cleBase = await crypto.subtle.importKey("raw", encodeur.encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    // `as BufferSource` : incompatibilité de typage connue entre les
    // définitions récentes de Uint8Array (générique sur ArrayBufferLike,
    // qui inclut SharedArrayBuffer) et BufferSource attendu par l'API Web
    // Crypto — purement un désaccord de typage TypeScript, sans impact à
    // l'exécution (le tableau est bien un ArrayBuffer classique ici).
    { name: "PBKDF2", salt: sel as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    cleBase,
    256
  );
  return bufVersHex(bits);
}

/** À appeler juste après une connexion EN LIGNE réussie — met à jour
 * l'empreinte locale de CE compte (n'affecte jamais les autres comptes déjà
 * enregistrés sur cet appareil), utilisable pour les reconnexions
 * hors-ligne suivantes. */
export async function enregistrerVerificationLocale(email: string, motDePasse: string): Promise<void> {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriverEmpreinte(motDePasse, sel);
  const table = lireTable();
  table[email.trim().toLowerCase()] = { sel: bufVersHex(sel), hash };
  ecrireTable(table);
}

/** true si l'email + mot de passe fournis correspondent à la dernière
 * connexion en ligne réussie de CE compte sur cet appareil — peu importe
 * si d'autres comptes se sont connectés entre-temps. */
export async function verifierLocalement(email: string, motDePasse: string): Promise<boolean> {
  const table = lireTable();
  const empreinte = table[email.trim().toLowerCase()];
  if (!empreinte) return false;
  const hash = await deriverEmpreinte(motDePasse, hexVersOctets(empreinte.sel));
  return hash === empreinte.hash;
}

/** Retire uniquement l'empreinte de CE compte — les autres comptes déjà
 * enregistrés sur cet appareil ne sont pas affectés. */
export function effacerVerrouLocal(email: string): void {
  const table = lireTable();
  delete table[email.trim().toLowerCase()];
  ecrireTable(table);
}

/** true si UNE empreinte existe pour cet email sur cet appareil (peu importe
 * si le mot de passe fourni ensuite sera correct) — utile pour distinguer
 * "jamais connecté ici" de "mot de passe incorrect" dans le message affiché
 * à l'agent hors-ligne. */
export function aUnVerrouPour(email: string): boolean {
  const table = lireTable();
  return email.trim().toLowerCase() in table;
}

/** Efface TOUS les comptes enregistrés sur cet appareil — réservé à une
 * purge complète (appareil qui change de main), jamais à une simple
 * déconnexion. */
export function effacerTousLesVerrous(): void {
  localStorage.removeItem(CLE_VERROUS);
}
