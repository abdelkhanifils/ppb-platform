/**
 * Client API et file de synchronisation.
 *
 * Contrat imposé par le backend FastAPI existant (`/api/v1`) :
 *   POST /auth/login                                   → { access_token, refresh_token }
 *   GET  /auth/moi                                     → profil de l'agent
 *   GET  /passeports/cache-emission                    → passeports VIERGES du pays de l'agent
 *   POST /numerisations/{passeport_id}/pages/{n}       → corps = donnees_json (null pour 1 et 2)
 *   POST /numerisations/{passeport_id}/pages/{n}/ocr   → multipart, champ « photo » (archivage)
 *
 * Deux invariants portés par ce module :
 *
 * 1. ORDRE DES PAGES. Le serveur ne fait basculer le passeport de
 *    « Préchargé » à « Émis » que lorsque les 4 pages lui sont parvenues.
 *    On envoie donc toujours 1, 2, 3 puis 4 ; envoyer la page 4 en premier
 *    n'échouerait pas, mais retarderait le changement de statut sans raison.
 *
 * 2. IDEMPOTENCE. Le serveur identifie une numérisation par
 *    (passeport_id, page_num) et met à jour la ligne existante au lieu d'en
 *    créer une seconde. Une réponse réseau perdue après un succès serveur peut
 *    donc être rejouée sans risque de doublon — indispensable sur un réseau
 *    intermittent. On mémorise malgré tout les pages déjà acceptées pour ne pas
 *    renvoyer inutilement des données sur une connexion coûteuse.
 */
import {
  enregistrerCachePasseports,
  enregistrerEmission,
  definirMeta,
  listerEmissions,
  listerPasseportsCache,
  lireSession,
  type Emission,
  type PasseportCache,
  type SessionAgent,
} from './db';
import { apiBaseUrlCourante } from './i18n';
import { aUnVerrouPour, enregistrerVerificationLocale, verifierLocalement } from './verrouLocal';

const PREFIXE = '/api/v1';

export class ErreurReseau extends Error {}
export class ErreurAuthentification extends Error {}

/**
 * Refus 403 : la session est valide, c'est le *droit* qui manque.
 *
 * Sous-classe volontaire d'`ErreurAuthentification` pour que la file de
 * synchronisation existante continue de s'arrêter proprement, tout en
 * permettant au tableau de bord de distinguer « session expirée » (il faut se
 * reconnecter) de « ce compte n'a pas le rôle agent d'émission » (se
 * reconnecter n'y changera rien — c'est au serveur qu'il faut agir).
 */
export class ErreurAutorisation extends ErreurAuthentification {}

function urlApi(chemin: string): string {
  const base = apiBaseUrlCourante();
  return `${base}${PREFIXE}${chemin}`;
}

async function appeler(
  chemin: string,
  options: RequestInit & { authentifie?: boolean } = {},
): Promise<Response> {
  const { authentifie = true, headers, ...reste } = options;
  const entetes = new Headers(headers);

  if (authentifie) {
    const session = lireSession();
    if (!session) throw new ErreurAuthentification('Aucune session locale.');
    entetes.set('Authorization', `Bearer ${session.access_token}`);
  }

  let reponse: Response;
  try {
    reponse = await fetch(urlApi(chemin), { ...reste, headers: entetes });
  } catch (cause) {
    // Coupure réseau, DNS, CORS, serveur éteint : tous indiscernables ici, et
    // tous traités de la même façon — on réessaiera plus tard.
    throw new ErreurReseau(cause instanceof Error ? cause.message : 'Requête impossible.');
  }

  if (reponse.status === 403) {
    throw new ErreurAutorisation("Droits insuffisants pour cette opération (403).");
  }
  if (reponse.status === 401) {
    throw new ErreurAuthentification('Session expirée ou invalide (401).');
  }
  return reponse;
}

async function detailErreur(reponse: Response): Promise<string> {
  // 404 et 405 ne viennent presque jamais de la plateforme centrale : ils
  // signalent que la requête a atterri ailleurs (serveur de fichiers de
  // l'aperçu, adresse erronée). Le message doit désigner la cause réelle
  // plutôt qu'un code brut que personne ne peut interpréter sur le terrain.
  if (reponse.status === 404 || reponse.status === 405) {
    return (
      `HTTP ${reponse.status} — la requête n'a pas atteint la plateforme centrale ` +
      `(adresse utilisée : ${apiBaseUrlCourante()}). Ouvrez les réglages, ` +
      `lancez « Tester la connexion », puis rechargez la dernière version.`
    );
  }
  try {
    const corps = await reponse.json();
    if (typeof corps?.detail === 'string') return corps.detail;
    // Erreur de validation (422) : le serveur renvoie une LISTE d'objets. Brute,
    // elle est illisible ; on nomme le ou les champs refusés, seule information
    // exploitable pour comprendre un rejet répété.
    if (Array.isArray(corps?.detail)) {
      const problemes = (corps.detail as Array<{ loc?: unknown[]; msg?: string }>)
        .map((item) => {
          const champ = Array.isArray(item.loc) ? item.loc.filter(Boolean).join(' → ') : '';
          return [champ, item.msg].filter(Boolean).join(' : ');
        })
        .filter(Boolean);
      if (problemes.length > 0) return `HTTP ${reponse.status} — ${problemes.join(' ; ')}`;
    }
    return JSON.stringify(corps).slice(0, 240);
  } catch {
    return `HTTP ${reponse.status}`;
  }
}

/* ------------------------------------------------------------------ */
/* Diagnostic                                                          */
/* ------------------------------------------------------------------ */

export interface ResultatTest {
  ok: boolean;
  url: string;
  detail: string;
}

/**
 * Vérifie l'accessibilité de la plateforme depuis CET appareil.
 *
 * Indispensable sur le terrain : un agent ne peut pas ouvrir une console de
 * navigateur. `/health` est hors du préfixe `/api/v1` et ne demande aucune
 * authentification, ce qui isole le problème d'accès du problème
 * d'identifiants. Un échec du `fetch` lui-même désigne un blocage réseau ou
 * une autorisation d'origine (CORS) manquante côté serveur.
 */
export async function testerPlateforme(): Promise<ResultatTest> {
  const base = apiBaseUrlCourante();
  try {
    const reponse = await fetch(`${base}/health`, { method: 'GET' });
    return {
      ok: reponse.ok,
      url: base,
      detail: reponse.ok
        ? `HTTP ${reponse.status}`
        : `HTTP ${reponse.status} — adresse joignable mais réponse inattendue.`,
    };
  } catch {
    return {
      ok: false,
      url: base,
      detail:
        "Requête bloquée avant d'atteindre le serveur : soit l'appareil n'a pas " +
        "de réseau, soit le serveur n'autorise pas encore l'adresse de cette application.",
    };
  }
}

/**
 * Supprime le service worker et les caches, puis recharge.
 *
 * Une version précédente conservée hors connexion peut continuer à viser une
 * ancienne adresse d'API indéfiniment. Offrir un bouton évite d'expliquer à un
 * agent comment vider le cache d'un navigateur mobile.
 */
export async function reinitialiserCacheApplication(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const enregistrements = await navigator.serviceWorker.getRegistrations();
    await Promise.all(enregistrements.map((sw) => sw.unregister()));
  }
  if ('caches' in window) {
    const noms = await caches.keys();
    await Promise.all(noms.map((nom) => caches.delete(nom)));
  }
  location.reload();
}

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */

interface ProfilServeur {
  email?: string;
  role?: string;
  pays_id?: number;
  poste?: { nom?: string } | null;
  poste_nom?: string | null;
  nom?: string;
}

export async function connecter(email: string, motDePasse: string): Promise<SessionAgent> {
  let reponse: Response;
  try {
    reponse = await appeler('/auth/login', {
      authentifie: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: motDePasse }),
    });
  } catch (erreur) {
    if (erreur instanceof ErreurAuthentification) {
      throw new ErreurAuthentification('identifiants');
    }
    if (erreur instanceof ErreurReseau) {
      // Pas de réseau : dernière chance avant d'abandonner — une session
      // complète (jetons + profil) doit déjà être présente localement
      // (connexion en ligne réussie avant une déconnexion, ou avant
      // l'expiration du jeton — voir `deconnecter` plus bas, qui préserve
      // volontairement ces données), ET le mot de passe saisi doit
      // correspondre à l'empreinte enregistrée lors de cette
      // dernière connexion en ligne (voir ./verrouLocal.ts). On ne peut
      // JAMAIS obtenir de nouveaux jetons hors-ligne — c'est la session
      // existante qui est restituée telle quelle.
      const sessionExistante = lireSession();
      if (sessionExistante && sessionExistante.email === email.trim().toLowerCase() && (await verifierLocalement(email, motDePasse))) {
        return sessionExistante;
      }
      if (aUnVerrouPour(email)) {
        // Déjà connecté avec succès sur cet appareil, mais mot de passe
        // incorrect — vérifiable sans réseau, donc ce n'est pas un
        // problème de connectivité.
        throw new ErreurAuthentification('mot_de_passe_incorrect_local');
      }
    }
    throw erreur;
  }

  if (!reponse.ok) throw new Error(await detailErreur(reponse));
  const jetons = (await reponse.json()) as { access_token: string; refresh_token: string };

  const session: SessionAgent = {
    access_token: jetons.access_token,
    refresh_token: jetons.refresh_token,
    email: email.trim().toLowerCase(),
    role: null,
    pays_id: null,
    poste: null,
    connecte_le: new Date().toISOString(),
  };

  // Empreinte locale mise à jour à chaque connexion en ligne réussie — voir
  // le repli hors-ligne ci-dessus.
  await enregistrerVerificationLocale(email, motDePasse);

  // Le profil enrichit l'en-tête (poste, pays) mais n'est pas vital : une
  // session utilisable ne doit pas dépendre d'un second appel réussi.
  try {
    const profilReponse = await fetch(urlApi('/auth/moi'), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (profilReponse.ok) {
      const profil = (await profilReponse.json()) as ProfilServeur;
      session.role = profil.role ?? null;
      session.pays_id = typeof profil.pays_id === 'number' ? profil.pays_id : null;
      session.poste = profil.poste?.nom ?? profil.poste_nom ?? null;
    }
  } catch {
    /* profil facultatif */
  }

  return session;
}

/* ------------------------------------------------------------------ */
/* Cache des passeports vierges                                        */
/* ------------------------------------------------------------------ */

export interface ResultatStock {
  /** Nombre de passeports renvoyés par la plateforme. */
  recus: number;
  /** Taille du cache local après l'opération. */
  en_cache: number;
  /**
   * Vrai quand la plateforme a renvoyé une liste vide alors que l'appareil
   * possédait déjà un stock : celui-ci a été CONSERVÉ au lieu d'être effacé.
   */
  conserve: boolean;
}

/**
 * Recharge le stock de passeports vierges depuis la plateforme.
 *
 * Règle de sûreté ajoutée après une disparition de stock constatée sur le
 * terrain : une réponse vide n'efface JAMAIS un cache local non vide. La
 * plateforme ne renvoie que les passeports au statut « vierge » du pays de
 * l'agent ; un lot repassé à un autre statut côté serveur, ou un compte
 * rattaché à un autre pays, produit donc une liste vide — ce qui, en écrasant
 * le cache, privait l'agent de tout son stock hors connexion sans aucune
 * explication. Mieux vaut conserver un stock légèrement périmé (le serveur
 * refusera de toute façon une émission en double, l'envoi étant idempotent)
 * que de rendre l'application inutilisable loin du réseau.
 */
export async function rafraichirCachePasseports(): Promise<ResultatStock> {
  const reponse = await appeler('/passeports/cache-emission');
  if (!reponse.ok) throw new Error(await detailErreur(reponse));
  const liste = (await reponse.json()) as PasseportCache[];

  if (liste.length === 0) {
    const cacheActuel = await listerPasseportsCache();
    if (cacheActuel.length > 0) {
      return { recus: 0, en_cache: cacheActuel.length, conserve: true };
    }
  }

  await enregistrerCachePasseports(liste);
  return { recus: liste.length, en_cache: liste.length, conserve: false };
}

/* ------------------------------------------------------------------ */
/* Diagnostic du stock                                                 */
/* ------------------------------------------------------------------ */

/** Cause identifiée d'un stock d'émission vide. */
export type CauseStock = 'ok' | 'role_invalide' | 'aucun_passeport' | 'aucun_vierge' | 'indisponible';

export interface DiagnosticStock {
  cause: CauseStock;
  /** Tous statuts confondus, pour le pays du compte connecté. */
  total: number;
  /** Répartition par statut, du plus nombreux au moins nombreux. */
  par_statut: Array<{ statut: string; nombre: number }>;
  vierges: number;
}

/**
 * Explique pourquoi le stock d'émission est vide.
 *
 * `GET /passeports/cache-emission` est volontairement restrictif : rôle agent
 * d'émission exigé, statut « vierge » uniquement, pays du compte uniquement. Un
 * résultat vide est donc ambigu sur le terrain. `GET /passeports` est ouvert à
 * tous les rôles authentifiés et renvoie le statut de chaque passeport du pays :
 * comparer les deux transforme un « stock vide » opaque en cause actionnable.
 */
export async function diagnostiquerStock(): Promise<DiagnosticStock> {
  const vide: DiagnosticStock = { cause: 'indisponible', total: 0, par_statut: [], vierges: 0 };

  let reponse: Response;
  try {
    reponse = await appeler('/passeports');
  } catch (cause) {
    // Un 403 ici signifie que même la consultation est refusée : le compte n'a
    // pas les droits attendus pour un agent d'émission.
    if (cause instanceof ErreurAutorisation) return { ...vide, cause: 'role_invalide' };
    throw cause;
  }
  if (!reponse.ok) return vide;

  const liste = (await reponse.json()) as Array<{ statut?: string }>;
  const compteur = new Map<string, number>();
  for (const passeport of liste) {
    const statut = passeport.statut ?? 'inconnu';
    compteur.set(statut, (compteur.get(statut) ?? 0) + 1);
  }
  const par_statut = [...compteur.entries()]
    .map(([statut, nombre]) => ({ statut, nombre }))
    .sort((a, b) => b.nombre - a.nombre);
  const vierges = compteur.get('vierge') ?? 0;

  let cause: CauseStock;
  if (liste.length === 0) cause = 'aucun_passeport';
  else if (vierges === 0) cause = 'aucun_vierge';
  else cause = 'ok';

  return { cause, total: liste.length, par_statut, vierges };
}

/* ------------------------------------------------------------------ */
/* Consultation des données enregistrées                               */
/* ------------------------------------------------------------------ */

/** Une page telle que la plateforme centrale l'a effectivement enregistrée. */
export interface PageEnregistree {
  page_num: number;
  statut_validation: string;
  statut_sync: string;
  donnees_json: Record<string, unknown>;
  enregistre_le: string | null;
}

export interface PasseportEnregistre {
  passeport_id: string;
  numero: string;
  statut_passeport: string;
  pages: PageEnregistree[];
}

/**
 * Relit depuis la base centrale les données réellement enregistrées.
 *
 * `GET /numerisations/{id}` ne renvoyait auparavant que les statuts de pages :
 * les valeurs saisies partaient bien en base mais restaient invisibles, d'où
 * l'impossibilité de vérifier ce qui avait été transmis. La route inclut
 * désormais `donnees_json`, ce qui permet de CONFRONTER l'écran de consultation
 * à la base plutôt que de se contenter d'afficher la copie locale — seule façon
 * de prouver à l'agent que son travail est bien enregistré côté plateforme.
 *
 * Renvoie `null` quand le passeport n'est pas encore connu du serveur (404),
 * cas normal tant que la file de synchronisation n'a pas été vidée.
 */
export async function lirePasseportEnregistre(
  passeportId: string,
): Promise<PasseportEnregistre | null> {
  const reponse = await appeler(`/numerisations/${passeportId}`);
  if (reponse.status === 404) return null;
  if (!reponse.ok) throw new Error(await detailErreur(reponse));

  const corps = await reponse.json();

  // La route a existé dans une version renvoyant une simple LISTE de statuts.
  // Un appareil peut donc interroger un serveur non encore redéployé : on
  // accepte les deux formes plutôt que d'afficher une erreur incompréhensible.
  if (Array.isArray(corps)) {
    return {
      passeport_id: passeportId,
      numero: '',
      statut_passeport: '',
      pages: (corps as Array<Record<string, unknown>>).map((page) => ({
        page_num: Number(page.page_num ?? 0),
        statut_validation: String(page.statut_validation ?? ''),
        statut_sync: String(page.statut_sync ?? ''),
        donnees_json: (page.donnees_json as Record<string, unknown>) ?? {},
        enregistre_le: (page.enregistre_le as string) ?? null,
      })),
    };
  }

  return corps as PasseportEnregistre;
}

/* ------------------------------------------------------------------ */
/* Envoi d'une émission                                                */
/* ------------------------------------------------------------------ */

async function envoyerPage(
  passeportId: string,
  pageNum: 1 | 2 | 3 | 4,
  donnees: unknown,
): Promise<string | null> {
  const reponse = await appeler(`/numerisations/${passeportId}/pages/${pageNum}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpsDePage(donnees)),
  });
  if (!reponse.ok) throw new Error(await detailErreur(reponse));
  const corps = (await reponse.json()) as { statut_passeport?: string };
  return corps.statut_passeport ?? null;
}

/**
 * Corps d'une page.
 *
 * Le serveur déclare `donnees_json` comme un corps de requête OBLIGATOIRE
 * (`dict | None` sans valeur par défaut) : un corps `null` est refusé en 422
 * « Field required », et non traité comme « pas de données ». Les pages 1 et 2
 * ne portant aucune donnée manuscrite, elles doivent donc partir avec un objet
 * VIDE. C'est la cause du « Échec — sera réessayé » perpétuel constaté sur le
 * terrain : chaque tentative échouait sur la toute première page, et aucune
 * n'atteignait jamais les pages 3 et 4.
 */
function corpsDePage(donnees: unknown): unknown {
  return donnees ?? {};
}

/**
 * Reconnaissance automatique VIA LE SERVEUR (Google Vision, voir
 * backend/app/services/ocr_service.py) — à la différence de
 * `envoyerPhoto` ci-dessus (qui archive la photo pendant la
 * synchronisation, sans jamais utiliser les champs suggérés), celle-ci
 * s'utilise au moment même de la capture, pour proposer un pré-remplissage
 * nettement plus fiable que la reconnaissance locale (Tesseract) sur de
 * l'écriture manuscrite.
 *
 * Nécessite une connexion réseau — c'est un appel serveur, pas une analyse
 * locale. Repli : `null` sur toute erreur (hors-ligne, service non
 * configuré côté serveur, délai dépassé) — l'appelant retombe alors sur la
 * reconnaissance locale, jamais un blocage pour l'agent.
 */
export interface ReponseOcrCloud {
  champs: unknown;
  /** Liste brute des mots reconnus par Google Vision, coordonnées PIXEL de
   * la photo envoyée — voir ocr.ts::assemblerChampsCloudParPosition, qui
   * combine cette lecture avec NOTRE détection de position (marqueurs de
   * coin + homographie), plus précise qu'un ancrage sur libellé imprimé. */
  mots: Array<{ texte: string; x_min: number; x_max: number; y_min: number; y_max: number }>;
}

export async function reconnaitrePageCloud(
  passeportId: string,
  pageNum: 3 | 4,
  photo: Blob,
): Promise<ReponseOcrCloud | null> {
  try {
    const formulaire = new FormData();
    formulaire.append('photo', photo, `passeport-page-${pageNum}.jpg`);
    const reponse = await appeler(`/numerisations/${passeportId}/pages/${pageNum}/ocr`, {
      method: 'POST',
      body: formulaire,
    });
    if (!reponse.ok) return null;
    const donnees = await reponse.json();
    if (!donnees?.champs) return null;
    return { champs: donnees.champs, mots: Array.isArray(donnees.mots) ? donnees.mots : [] };
  } catch {
    return null;
  }
}

/**
 * Archivage de la photo. Volontairement tolérant : cette route peut répondre
 * 503 quand l'OCR serveur n'est pas configuré, et une photo non archivée ne
 * doit jamais empêcher une émission d'être considérée comme synchronisée.
 */
async function envoyerPhoto(passeportId: string, pageNum: 3 | 4, photo: Blob): Promise<boolean> {
  try {
    const formulaire = new FormData();
    formulaire.append('photo', photo, `passeport-page-${pageNum}.jpg`);
    const reponse = await appeler(`/numerisations/${passeportId}/pages/${pageNum}/ocr`, {
      method: 'POST',
      body: formulaire,
    });
    return reponse.ok;
  } catch {
    return false;
  }
}

/** Envoie une émission page par page, en reprenant là où un envoi précédent s'était arrêté. */
export async function synchroniserEmission(emission: Emission): Promise<Emission> {
  const courante: Emission = { ...emission, etat_synchro: 'en_cours' };
  await enregistrerEmission(courante);

  // Pages 1 et 2 : aucune donnée manuscrite, mais un objet vide et non `null`
  // (voir corpsDePage — le serveur exige un corps présent).
  const aEnvoyer: Array<{ page: 1 | 2 | 3 | 4; donnees: unknown }> = [
    { page: 1, donnees: {} },
    { page: 2, donnees: {} },
    { page: 3, donnees: emission.page3 },
    { page: 4, donnees: emission.page4 },
  ];

  try {
    for (const { page, donnees } of aEnvoyer) {
      if (courante.pages_envoyees.includes(page)) continue;
      const statut = await envoyerPage(courante.passeport_id, page, donnees);
      courante.pages_envoyees = [...courante.pages_envoyees, page];
      if (statut) courante.statut_serveur = statut;
      await enregistrerEmission(courante);
    }

    const photos: Array<{ page: 3 | 4; blob?: Blob }> = [
      { page: 3, blob: emission.photo_page3 },
      { page: 4, blob: emission.photo_page4 },
    ];
    for (const { page, blob } of photos) {
      if (!blob || courante.photos_envoyees.includes(page)) continue;
      const envoye = await envoyerPhoto(courante.passeport_id, page, blob);
      if (envoye) {
        courante.photos_envoyees = [...courante.photos_envoyees, page];
      }
    }

    courante.etat_synchro = 'synchronisee';
    courante.derniere_erreur = null;
    await enregistrerEmission(courante);
    return courante;
  } catch (erreur) {
    courante.etat_synchro = 'erreur';
    courante.tentatives += 1;
    courante.derniere_erreur = erreur instanceof Error ? erreur.message : 'Erreur inconnue.';
    await enregistrerEmission(courante);
    if (erreur instanceof ErreurAuthentification) throw erreur;
    return courante;
  }
}

export interface ResultatSynchro {
  traitees: number;
  reussies: number;
  echouees: number;
  hors_ligne: boolean;
  authentification_perdue: boolean;
}

let synchroEnCours = false;

/**
 * Vide la file. Un seul passage à la fois : le déclencheur automatique
 * (événement `online`) et le bouton manuel peuvent se produire en même temps,
 * et deux passages simultanés se marcheraient sur les pieds.
 */
export async function synchroniserTout(): Promise<ResultatSynchro> {
  const resultat: ResultatSynchro = {
    traitees: 0,
    reussies: 0,
    echouees: 0,
    hors_ligne: false,
    authentification_perdue: false,
  };

  if (synchroEnCours) return resultat;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    resultat.hors_ligne = true;
    return resultat;
  }
  if (!lireSession()) return resultat;

  synchroEnCours = true;
  try {
    const emissions = await listerEmissions();
    const enAttente = emissions.filter((e) => e.etat_synchro !== 'synchronisee');

    for (const emission of enAttente) {
      resultat.traitees += 1;
      try {
        const apres = await synchroniserEmission(emission);
        if (apres.etat_synchro === 'synchronisee') resultat.reussies += 1;
        else resultat.echouees += 1;
      } catch (erreur) {
        resultat.echouees += 1;
        if (erreur instanceof ErreurAuthentification) {
          resultat.authentification_perdue = true;
          break;
        }
        if (erreur instanceof ErreurReseau) {
          resultat.hors_ligne = true;
          break;
        }
      }
    }

    if (resultat.reussies > 0) {
      await definirMeta('derniere_synchro_emissions', new Date().toISOString());
    }
  } finally {
    synchroEnCours = false;
  }

  return resultat;
}

export interface ResultatRafraichissementStock {
  ok: boolean;
  resultat?: ResultatStock;
  authentification_perdue: boolean;
}

/**
 * Rafraîchissement automatique du stock : au retour du réseau, puis à
 * intervalle régulier tant que l'agent est connecté. Même logique que
 * `demarrerSynchroAutomatique` (temporisation croissante après un échec),
 * pour que « Mettre à jour le stock » n'exige plus de geste sur le terrain.
 *
 * Intervalle de base plus long que celui des émissions (60 s contre 30 s) :
 * le stock change moins souvent qu'une file d'émissions en attente, inutile
 * de solliciter la plateforme aussi fréquemment pour une simple lecture.
 */
export function demarrerRafraichissementStockAutomatique(
  onResultat: (resultat: ResultatRafraichissementStock) => void,
): () => void {
  let attente = 60_000;
  let minuteur: number | undefined;
  let actif = true;

  const lancer = async () => {
    if (!actif) return;
    const horsLigne = typeof navigator !== 'undefined' && !navigator.onLine;
    if (!horsLigne && lireSession()) {
      try {
        const resultat = await rafraichirCachePasseports();
        if (!actif) return;
        onResultat({ ok: true, resultat, authentification_perdue: false });
        attente = 5 * 60_000;
      } catch (erreur) {
        if (!actif) return;
        if (erreur instanceof ErreurAuthentification) {
          onResultat({ ok: false, authentification_perdue: true });
          return; // Se reconnecter est requis : inutile de reprogrammer un essai.
        }
        attente = Math.min(attente * 2, 5 * 60_000);
      }
    }
    minuteur = window.setTimeout(lancer, attente);
  };

  const auRetourReseau = () => {
    attente = 60_000;
    window.clearTimeout(minuteur);
    void lancer();
  };

  window.addEventListener('online', auRetourReseau);
  minuteur = window.setTimeout(lancer, 6_000);

  return () => {
    actif = false;
    window.clearTimeout(minuteur);
    window.removeEventListener('online', auRetourReseau);
  };
}

/**
 * Déconnexion : verrouille l'app (retour à l'écran de connexion, voir
 * pages/Index.tsx qui bascule sur l'état React, pas sur ce module) SANS
 * effacer la session locale ni l'empreinte du mot de passe — c'est ce qui
 * permet à l'agent de se reconnecter hors-ligne juste après avec son mot de
 * passe habituel (voir `connecter` ci-dessus). Les synchronisations en
 * arrière-plan s'arrêtent d'elles-mêmes au démontage de TableauDeBord,
 * indépendamment de ce que contient le stockage local.
 */
export function deconnecter(): void {
  /* volontairement aucune action ici désormais — voir la docstring */
}

/**
 * Réessais automatiques : au retour du réseau, puis à intervalle régulier tant
 * qu'il reste des émissions en attente. La temporisation croît après chaque
 * échec pour ne pas épuiser la batterie ni le forfait de données de l'agent
 * face à un serveur durablement injoignable.
 */
export function demarrerSynchroAutomatique(
  onResultat: (resultat: ResultatSynchro) => void,
): () => void {
  let attente = 30_000;
  let minuteur: number | undefined;
  let actif = true;

  const lancer = async () => {
    if (!actif) return;
    const resultat = await synchroniserTout();
    if (!actif) return;
    if (resultat.traitees > 0) onResultat(resultat);
    attente = resultat.echouees > 0 || resultat.hors_ligne ? Math.min(attente * 2, 300_000) : 30_000;
    minuteur = window.setTimeout(lancer, attente);
  };

  const auRetourReseau = () => {
    attente = 30_000;
    window.clearTimeout(minuteur);
    void lancer();
  };

  window.addEventListener('online', auRetourReseau);
  minuteur = window.setTimeout(lancer, 4_000);

  return () => {
    actif = false;
    window.clearTimeout(minuteur);
    window.removeEventListener('online', auRetourReseau);
  };
}