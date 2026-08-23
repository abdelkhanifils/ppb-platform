/**
 * Internationalisation FR/EN et réglages persistants.
 *
 * Les libellés de l'INTERFACE sont bilingues. En revanche, les libellés
 * IMPRIMÉS du passeport papier utilisés comme ancres par l'OCR (« Nom et
 * prénom », « N° CNI », « Bovins », ...) restent toujours en français dans
 * `lib/ocr.ts` : ils décrivent le gabarit physique, pas l'interface.
 *
 * Les réglages (langue, URL de l'API) vivent dans `localStorage` : lecture
 * synchrone au démarrage, indispensable pour rendre le premier écran sans
 * attendre une transaction IndexedDB, et disponible hors connexion.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Langue = 'fr' | 'en';

const CLE_LANGUE = 'ppb.langue';

/**
 * Clé versionnée volontairement.
 *
 * Une valeur enregistrée lors d'une session précédente (notamment l'URL vide
 * qui visait le proxy de développement) survivrait à une mise à jour de
 * l'application et enverrait les requêtes vers le serveur de fichiers de
 * l'aperçu, lequel répond « 405 Method Not Allowed » à un POST. Changer la clé
 * neutralise ces valeurs périmées sans rien demander à l'agent.
 */
const CLE_API = 'ppb.api_base_url.v2';

/**
 * Plateforme centrale par défaut (déploiement Railway de l'utilisateur).
 *
 * Pré-remplir cette valeur évite à chaque agent de terrain de saisir une URL
 * longue sur un clavier de téléphone — une source d'erreur qui bloquerait la
 * toute première connexion, celle qui exige justement du réseau. L'URL reste
 * modifiable dans les réglages pour un environnement de test ou de recette.
 */
export const API_PAR_DEFAUT = 'https://fearless-insight-production-1910.up.railway.app';

type Entree = { fr: string; en: string };

const DICO: Record<string, Entree> = {
  'app.nom': { fr: 'PPB Émission', en: 'PPB Issuance' },
  'app.sous_titre': {
    fr: 'Passeport pour Bétail — émission terrain',
    en: 'Livestock Passport — field issuance',
  },
  'app.organisme': { fr: 'CEBEVIRHA — CEMAC', en: 'CEBEVIRHA — CEMAC' },

  'reseau.en_ligne': { fr: 'En ligne', en: 'Online' },
  'reseau.hors_ligne': { fr: 'Hors connexion', en: 'Offline' },
  'reseau.mode_terrain': {
    fr: 'Mode terrain : tout fonctionne sans réseau.',
    en: 'Field mode: everything works without a network.',
  },

  'action.continuer': { fr: 'Continuer', en: 'Continue' },
  'action.retour': { fr: 'Retour', en: 'Back' },
  'action.annuler': { fr: 'Annuler', en: 'Cancel' },
  'action.fermer': { fr: 'Fermer', en: 'Close' },
  'action.enregistrer': { fr: 'Enregistrer', en: 'Save' },
  'action.reessayer': { fr: 'Réessayer', en: 'Try again' },
  'action.scanner': { fr: 'Scanner', en: 'Scan' },
  'action.rescanner': { fr: 'Scanner à nouveau', en: 'Scan again' },
  'action.saisie_manuelle': { fr: 'Saisir à la main', en: 'Enter manually' },
  'action.prendre_photo': { fr: 'Prendre la photo', en: 'Take the photo' },
  'action.importer_photo': { fr: 'Choisir une photo', en: 'Choose a photo' },
  'action.ignorer_scan': { fr: 'Remplir sans scanner', en: 'Fill in without scanning' },

  'connexion.titre': { fr: 'Connexion agent', en: 'Agent sign-in' },
  'connexion.intro': {
    fr: 'Connectez-vous une fois avec Internet. Votre session reste ensuite utilisable hors connexion.',
    en: 'Sign in once with Internet access. Your session then stays usable offline.',
  },
  'connexion.email': { fr: 'Adresse e-mail', en: 'Email address' },
  'connexion.mot_de_passe': { fr: 'Mot de passe', en: 'Password' },
  'connexion.valider': { fr: 'Se connecter', en: 'Sign in' },
  'connexion.en_cours': { fr: 'Connexion en cours…', en: 'Signing in…' },
  'connexion.deconnexion': { fr: 'Se déconnecter', en: 'Sign out' },
  'connexion.echec_reseau': {
    fr: "Serveur injoignable. Vérifiez l'URL de l'API dans les réglages, ou attendez de retrouver du réseau.",
    en: 'Server unreachable. Check the API URL in settings, or wait until the network is back.',
  },
  'connexion.identifiants_invalides': {
    fr: 'Adresse e-mail ou mot de passe incorrect.',
    en: 'Incorrect email address or password.',
  },
  'connexion.hors_ligne': {
    fr: 'Première connexion impossible hors réseau : elle doit être vérifiée par la plateforme centrale.',
    en: 'A first sign-in requires a network: it must be verified by the central platform.',
  },
  'connexion.session_expiree': {
    fr: 'Session expirée. Reconnectez-vous dès que le réseau revient.',
    en: 'Session expired. Sign in again as soon as the network returns.',
  },

  'reglages.titre': { fr: 'Réglages', en: 'Settings' },
  'reglages.langue': { fr: 'Langue', en: 'Language' },
  'reglages.api': { fr: 'URL de la plateforme centrale', en: 'Central platform URL' },
  'reglages.api_aide': {
    fr: 'Laissez la valeur par défaut, sauf pour tester un autre serveur.',
    en: 'Keep the default value, unless testing another server.',
  },
  'reglages.enregistres': { fr: 'Réglages enregistrés.', en: 'Settings saved.' },
  'reglages.tester': { fr: 'Tester la connexion', en: 'Test the connection' },
  'reglages.test_encours': { fr: 'Test en cours…', en: 'Testing…' },
  'reglages.test_ok': { fr: 'Plateforme centrale joignable.', en: 'Central platform reachable.' },
  'reglages.test_echec': {
    fr: 'Plateforme injoignable depuis cet appareil.',
    en: 'Platform unreachable from this device.',
  },
  'reglages.vider_cache': { fr: 'Recharger la dernière version', en: 'Reload the latest version' },
  'reglages.vider_cache_aide': {
    fr: 'À utiliser si l’application semble figée sur une ancienne version.',
    en: 'Use this if the app seems stuck on an older version.',
  },

  'tdb.bonjour': { fr: 'Poste vétérinaire', en: 'Veterinary post' },
  'tdb.stock': { fr: 'Passeports vierges', en: 'Blank passports' },
  'tdb.emis_jour': { fr: 'Émis aujourd’hui', en: 'Issued today' },
  'tdb.en_attente': { fr: 'À synchroniser', en: 'To synchronise' },
  'tdb.derniere_synchro': { fr: 'Dernière synchronisation', en: 'Last synchronisation' },
  'tdb.jamais': { fr: 'jamais', en: 'never' },
  'tdb.nouvelle_emission': { fr: 'Nouvelle émission', en: 'New issuance' },
  'tdb.rafraichir_stock': { fr: 'Mettre à jour le stock', en: 'Update stock' },
  'tdb.stock_mis_a_jour': {
    fr: 'Stock de passeports vierges mis à jour.',
    en: 'Blank passport stock updated.',
  },
  'tdb.stock_vide_titre': { fr: 'Aucun passeport vierge en réserve', en: 'No blank passport in stock' },
  'tdb.stock_vide_texte': {
    fr: 'Connectez-vous au réseau une fois pour télécharger les passeports attribués à votre poste. Ils resteront ensuite disponibles hors connexion.',
    en: 'Connect to the network once to download the passports allocated to your post. They then stay available offline.',
  },
  'tdb.stock_conserve': {
    fr: 'La plateforme ne renvoie aucun passeport vierge : votre stock déjà téléchargé a été conservé.',
    en: 'The platform returned no blank passport: your already downloaded stock has been kept.',
  },
  'tdb.diagnostic_stock': { fr: 'Analyser le stock', en: 'Analyse stock' },
  'tdb.diagnostic_en_cours': { fr: 'Analyse en cours…', en: 'Analysing…' },
  'tdb.diagnostic_titre': { fr: 'Résultat de l’analyse', en: 'Analysis result' },
  'tdb.diag_role_invalide': {
    fr: 'Ce compte n’a pas le rôle « agent d’émission » : la plateforme refuse de lui livrer un stock de passeports. Demandez à l’administrateur national de corriger le rôle du compte.',
    en: 'This account does not have the “issuance agent” role, so the platform refuses to deliver a passport stock. Ask the national administrator to fix the account role.',
  },
  'tdb.diag_aucun_passeport': {
    fr: 'Aucun passeport n’existe pour le pays rattaché à ce compte. Soit le compte est rattaché au mauvais pays, soit aucun lot n’a encore été attribué.',
    en: 'No passport exists for the country linked to this account. Either the account is linked to the wrong country, or no batch has been allocated yet.',
  },
  'tdb.diag_aucun_vierge': {
    fr: 'Des passeports existent pour votre pays, mais aucun n’est au statut « vierge » — seul ce statut est distribué aux agents. Les lots encore « préchargés » doivent d’abord être confirmés à l’impression.',
    en: 'Passports exist for your country, but none is in “blank” status — only that status is distributed to agents. Batches still “preloaded” must first be confirmed as printed.',
  },
  'tdb.diag_ok': {
    fr: 'Des passeports vierges sont bien disponibles côté plateforme. Mettez le stock à jour pour les récupérer.',
    en: 'Blank passports are available on the platform. Update the stock to retrieve them.',
  },
  'tdb.diag_indisponible': {
    fr: 'L’analyse n’a pas pu aboutir. Vérifiez la connexion à la plateforme puis réessayez.',
    en: 'The analysis could not complete. Check the platform connection and try again.',
  },
  'tdb.diag_repartition': { fr: 'Répartition par statut', en: 'Breakdown by status' },
  'tdb.historique': { fr: 'Émissions enregistrées', en: 'Recorded issuances' },
  'tdb.historique_vide': {
    fr: 'Vos émissions apparaîtront ici, même sans réseau.',
    en: 'Your issuances will appear here, even without a network.',
  },
  'tdb.file_synchro': { fr: 'File de synchronisation', en: 'Synchronisation queue' },
  'tdb.synchroniser': { fr: 'Synchroniser maintenant', en: 'Synchronise now' },
  'tdb.synchro_en_cours': { fr: 'Synchronisation…', en: 'Synchronising…' },
  'tdb.synchro_terminee': { fr: 'Émissions transmises à la plateforme.', en: 'Issuances sent to the platform.' },
  'tdb.synchro_hors_ligne': {
    fr: 'Pas de réseau : les émissions partiront automatiquement au retour de la connexion.',
    en: 'No network: issuances will be sent automatically when the connection returns.',
  },

  'statut.en_attente': { fr: 'En attente', en: 'Pending' },
  'statut.en_cours': { fr: 'Envoi en cours', en: 'Sending' },
  'statut.synchronisee': { fr: 'Synchronisée', en: 'Synchronised' },
  'statut.erreur': { fr: 'Échec — sera réessayé', en: 'Failed — will retry' },

  'emission.titre': { fr: 'Émission d’un passeport', en: 'Passport issuance' },
  'emission.etape': { fr: 'Étape', en: 'Step' },
  'emission.sur': { fr: 'sur', en: 'of' },
  'emission.quitter': { fr: 'Quitter l’émission', en: 'Leave issuance' },

  'etape1.titre': { fr: 'Vérification du passeport', en: 'Passport check' },
  'etape1.intro': {
    fr: 'Contrôlez le document papier avant toute saisie : hologramme présent, guilloches nettes, numéro lisible, aucune page arrachée.',
    en: 'Check the paper document before any data entry: hologram present, crisp guilloche pattern, legible number, no torn page.',
  },
  'etape1.point1': { fr: 'Hologramme et guilloches conformes', en: 'Hologram and guilloche pattern compliant' },
  'etape1.point2': { fr: 'Numéro du passeport lisible', en: 'Passport number legible' },
  'etape1.point3': {
    fr: 'Pages 3 et 4 remplies au stylo, à l’encre noire, en MAJUSCULES',
    en: 'Pages 3 and 4 filled in with a black-ink pen, in CAPITALS',
  },
  'etape1.confirmer': { fr: 'Le passeport est conforme', en: 'The passport is compliant' },

  'etape2.titre': { fr: 'Sélection du passeport', en: 'Passport selection' },
  'etape2.intro': {
    fr: 'Scannez le QR Code du passeport, ou saisissez son numéro. La vérification se fait sur le stock enregistré dans l’appareil, sans réseau.',
    en: 'Scan the passport QR code, or type its number. Verification runs against the stock stored on the device, without a network.',
  },
  'etape2.numero': { fr: 'Numéro du passeport', en: 'Passport number' },
  'etape2.rechercher': { fr: 'Vérifier ce numéro', en: 'Check this number' },
  'etape2.authentique': { fr: 'Passeport authentique, disponible dans votre stock.', en: 'Authentic passport, available in your stock.' },
  'etape2.inconnu': {
    fr: 'Ce passeport n’appartient pas au stock de votre poste. Ne l’émettez pas et signalez-le à votre hiérarchie.',
    en: 'This passport does not belong to your post’s stock. Do not issue it and report it to your supervisor.',
  },
  'etape2.deja_emis': {
    fr: 'Ce passeport a déjà été émis depuis cet appareil.',
    en: 'This passport has already been issued from this device.',
  },

  'etape3.titre': { fr: 'Page 3 — Identification et trajet', en: 'Page 3 — Identification and route' },
  'etape4.titre': { fr: 'Page 4 — Santé, cheptel et contrôle', en: 'Page 4 — Health, herd and control' },
  'etape.scan_intro': {
    fr: 'Photographiez la page remplie au stylo. La reconnaissance se fait sur l’appareil, sans réseau, puis vous corrigez librement.',
    en: 'Photograph the page filled in with a pen. Recognition runs on the device, without a network, then you correct freely.',
  },
  'etape.ocr_en_cours': { fr: 'Lecture de la page…', en: 'Reading the page…' },
  'etape.ocr_prepare': { fr: 'Préparation du moteur de lecture…', en: 'Preparing the reading engine…' },
  'etape.ocr_reussi': {
    fr: 'champ(s) pré-remplis. Vérifiez chaque valeur avant de continuer.',
    en: 'field(s) pre-filled. Check every value before continuing.',
  },
  'etape.ocr_aucun': {
    fr: 'Aucun champ n’a pu être lu sur cette photo. Reprenez la photo à plat, bien éclairée, ou saisissez les données à la main.',
    en: 'No field could be read from this photo. Retake it flat and well lit, or enter the data manually.',
  },
  'etape.ocr_mots_lus': { fr: 'mot(s) reconnu(s) sur la photo', en: 'word(s) recognised in the photo' },
  'etape.ocr_extrait': { fr: 'Texte lu (extrait)', en: 'Text read (extract)' },
  'etape.ocr_echec': {
    fr: 'La lecture automatique a échoué. Le formulaire reste entièrement utilisable à la main.',
    en: 'Automatic reading failed. The form remains fully usable manually.',
  },

  'consult.titre': { fr: 'Passeport enregistré', en: 'Recorded passport' },
  'consult.intro': {
    fr: 'Données enregistrées pour ce passeport. Celles marquées « enregistré sur la plateforme » ont été relues depuis la base centrale ; les autres attendent encore leur envoi et sont lues depuis cet appareil.',
    en: 'Data recorded for this passport. Items marked “recorded on the platform” were read back from the central database; the others are still awaiting upload and are read from this device.',
  },
  'consult.ouvrir': { fr: 'Consulter', en: 'View' },
  'consult.source_locale': { fr: 'Sur cet appareil, envoi en attente', en: 'On this device, upload pending' },
  'consult.source_serveur': { fr: 'Enregistré sur la plateforme', en: 'Recorded on the platform' },
  'consult.verifier': { fr: 'Vérifier dans la base centrale', en: 'Check in the central database' },
  'consult.verification_en_cours': { fr: 'Vérification…', en: 'Checking…' },
  'consult.pages_recues': { fr: 'page(s) reçue(s) par la plateforme', en: 'page(s) received by the platform' },
  'consult.absent_serveur': {
    fr: 'Ce passeport n’est pas encore enregistré dans la base centrale. Lancez la synchronisation depuis le tableau de bord.',
    en: 'This passport is not yet recorded in the central database. Start synchronisation from the dashboard.',
  },
  'consult.echec': {
    fr: 'La base centrale n’a pas pu être interrogée. Les données affichées viennent de cet appareil.',
    en: 'The central database could not be queried. The data shown comes from this device.',
  },
  'consult.introuvable': {
    fr: 'Cette émission n’existe pas sur cet appareil.',
    en: 'This issuance does not exist on this device.',
  },
  'consult.effectifs': { fr: 'Effectifs par espèce', en: 'Headcount by species' },
  'consult.aucun_effectif': { fr: 'Aucun effectif saisi.', en: 'No headcount entered.' },
  'consult.aucune_vaccination': { fr: 'Aucune vaccination saisie.', en: 'No vaccination entered.' },
  'consult.males': { fr: 'Mâles', en: 'Males' },
  'consult.femelles_jeunes': { fr: 'Femelles jeunes', en: 'Young females' },
  'consult.femelles_adultes': { fr: 'Femelles adultes', en: 'Adult females' },

  'confiance.haute': { fr: 'Lu avec confiance', en: 'Read confidently' },
  'confiance.moyenne': { fr: 'À vérifier', en: 'To be checked' },
  'confiance.basse': { fr: 'Peu sûr — à corriger', en: 'Unreliable — correct it' },
  'confiance.aucune': { fr: 'Non reconnu', en: 'Not recognised' },
  'confiance.legende': {
    fr: 'Chaque champ lu automatiquement porte un indice de fiabilité. Rien n’est imposé : corrigez ce qui est faux.',
    en: 'Every automatically read field carries a reliability indicator. Nothing is imposed: correct whatever is wrong.',
  },

  'p3.eleveur': { fr: 'Propriétaire / éleveur', en: 'Owner / herder' },
  'p3.convoyeur': { fr: 'Convoyeur', en: 'Conveyor' },
  'p3.nom_prenom': { fr: 'Nom et prénom', en: 'First and last name' },
  'p3.cni': { fr: 'N° CNI', en: 'National ID number' },
  'p3.telephone': { fr: 'Téléphone', en: 'Phone number' },
  'p3.itineraire': { fr: 'Trajet déclaré', en: 'Declared route' },
  'p3.pays_origine': { fr: 'Pays d’origine', en: 'Country of origin' },
  'p3.province_origine': { fr: 'Province / région d’origine', en: 'Province / region of origin' },
  'p3.localite_origine': { fr: 'Localité d’origine', en: 'Locality of origin' },
  'p3.pays_destination': { fr: 'Pays de destination', en: 'Country of destination' },
  'p3.province_destination': { fr: 'Province / région de destination', en: 'Province / region of destination' },
  'p3.localite_destination': { fr: 'Localité de destination', en: 'Locality of destination' },

  'p4.effectifs': { fr: 'Composition du troupeau', en: 'Herd composition' },
  'p4.espece': { fr: 'Espèce', en: 'Species' },
  'p4.males': { fr: 'Mâles', en: 'Males' },
  'p4.femelles_jeunes': { fr: 'Femelles jeunes', en: 'Young females' },
  'p4.femelles_adultes': { fr: 'Femelles adultes', en: 'Adult females' },
  'p4.total': { fr: 'Total', en: 'Total' },
  'p4.total_general': { fr: 'Total général du cheptel', en: 'Overall herd total' },
  'p4.total_auto': {
    fr: 'Le total de chaque ligne est recalculé automatiquement.',
    en: 'Each row total is recalculated automatically.',
  },
  'p4.vaccinations': { fr: 'Traitements et vaccinations', en: 'Treatments and vaccinations' },
  'p4.vaccinations_aide': {
    fr: 'Renseignez la date pour chaque maladie contrôlée. Laissez vide si aucun traitement n’a été réalisé.',
    en: 'Enter the date for each controlled disease. Leave empty if no treatment was carried out.',
  },
  'p4.date_vaccination': { fr: 'Date', en: 'Date' },
  'p4.lieu_vaccination': { fr: 'Lieu', en: 'Place' },

  'espece.bovin': { fr: 'Bovins', en: 'Cattle' },
  'espece.ovin': { fr: 'Ovins', en: 'Sheep' },
  'espece.caprin': { fr: 'Caprins', en: 'Goats' },
  'espece.camelin': { fr: 'Camelins', en: 'Camels' },

  'maladie.peste_petits_ruminants': { fr: 'Peste des petits ruminants', en: 'Peste des petits ruminants' },
  'maladie.peripneumonie_contagieuse': { fr: 'Péripneumonie contagieuse', en: 'Contagious bovine pleuropneumonia' },
  'maladie.charbon': { fr: 'Charbon', en: 'Anthrax' },
  'maladie.trypanosomiase': { fr: 'Trypanosomiase', en: 'Trypanosomiasis' },

  'recap.titre': { fr: 'Récapitulatif avant validation', en: 'Summary before validation' },
  'recap.intro': {
    fr: 'Dernière vérification. Après validation, l’émission est enregistrée dans l’appareil et partira seule dès le retour du réseau.',
    en: 'Final check. Once validated, the issuance is stored on the device and will be sent on its own as soon as the network returns.',
  },
  'recap.passeport': { fr: 'Passeport', en: 'Passport' },
  'recap.position': { fr: 'Position GPS', en: 'GPS position' },
  'recap.position_absente': { fr: 'non disponible', en: 'not available' },
  'recap.photos': { fr: 'Photos conservées', en: 'Photos kept' },
  'recap.valider': { fr: 'Valider l’émission', en: 'Validate the issuance' },
  'recap.enregistrement': { fr: 'Enregistrement…', en: 'Saving…' },
  'recap.enregistree': {
    fr: 'Émission enregistrée sur l’appareil.',
    en: 'Issuance stored on the device.',
  },

  'camera.autorisation': {
    fr: 'Accès à la caméra refusé. Autorisez la caméra dans votre navigateur, ou choisissez une photo existante.',
    en: 'Camera access denied. Allow the camera in your browser, or choose an existing photo.',
  },
  'camera.cadre_qr': { fr: 'Cadrez le QR Code du passeport', en: 'Frame the passport QR code' },
  'camera.cadre_page': {
    fr: 'Alignez le cadre VERT imprimé sur le passeport avec ce repère — pas le bord du papier',
    en: "Align the passport's printed GREEN frame with this guide — not the paper edge",
  },
  'camera.conseil_page': {
    fr: 'Le cadre vert imprimé (près du bord de chaque page) doit remplir tout le repère à l\'écran. Évitez ombres et reflets — la lumière du jour sans soleil direct fonctionne mieux.',
    en: "The passport's printed green frame (near each page's edge) should fill the entire on-screen guide. Avoid shadows and glare — daylight without direct sun works best.",
  },
  'camera.recherche_qr': { fr: 'Recherche du QR Code…', en: 'Looking for the QR code…' },

  'validation.requis': { fr: 'Ce champ est obligatoire.', en: 'This field is required.' },
  'validation.champs_manquants': {
    fr: 'Complétez les champs obligatoires avant de continuer.',
    en: 'Complete the required fields before continuing.',
  },
  'validation.troupeau_vide': {
    fr: 'Renseignez au moins un animal dans le cheptel.',
    en: 'Enter at least one animal in the herd.',
  },
};

interface ContexteI18n {
  langue: Langue;
  changerLangue: (l: Langue) => void;
  t: (cle: string) => string;
  apiBaseUrl: string;
  definirApiBaseUrl: (url: string) => void;
}

const Contexte = createContext<ContexteI18n | null>(null);

function lireLangue(): Langue {
  const brut = typeof localStorage !== 'undefined' ? localStorage.getItem(CLE_LANGUE) : null;
  return brut === 'en' ? 'en' : 'fr';
}

/**
 * Ramène une saisie humaine à une origine exploitable.
 *
 * Sur le terrain, l'URL est tapée au pouce : espace final, slash en trop, ou
 * copie du lien de la documentation (`.../api/v1/docs`). Le client ajoutant
 * déjà le préfixe `/api/v1`, on retire tout suffixe de chemin déjà présent
 * pour éviter un `/api/v1/api/v1/...` silencieusement introuvable.
 * Renvoie une chaîne vide si la valeur n'est pas une adresse absolue.
 */
function normaliserApi(brut: string): string {
  const propre = brut.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(propre)) return '';
  return propre.replace(/\/api\/v1(\/.*)?$/i, '');
}

/**
 * Une adresse pointant vers l'application elle-même ne peut pas être l'API.
 *
 * Ce cas se produit quand une ancienne version, servie depuis le cache hors
 * connexion, a mémorisé l'adresse du proxy de développement : le POST de
 * connexion part alors vers le serveur de fichiers, qui répond « 405 Method
 * Not Allowed ». On le détecte pour retomber sur la plateforme réelle au lieu
 * d'afficher une erreur incompréhensible.
 */
function viseLApplication(url: string): boolean {
  return typeof location !== 'undefined' && url === location.origin;
}

function lireApi(): string {
  if (typeof localStorage === 'undefined') return API_PAR_DEFAUT;
  const enregistre = normaliserApi(localStorage.getItem(CLE_API) ?? '');
  if (!enregistre || viseLApplication(enregistre)) return API_PAR_DEFAUT;
  return enregistre;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [langue, setLangue] = useState<Langue>(lireLangue);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(lireApi);

  useEffect(() => {
    document.documentElement.lang = langue;
  }, [langue]);

  const changerLangue = useCallback((l: Langue) => {
    localStorage.setItem(CLE_LANGUE, l);
    setLangue(l);
  }, []);

  const definirApiBaseUrl = useCallback((url: string) => {
    // Une saisie inutilisable ne doit jamais remplacer une adresse qui marche :
    // on retombe sur la plateforme par défaut plutôt que d'enregistrer un
    // fragment qui ferait échouer toutes les connexions suivantes.
    const candidat = normaliserApi(url);
    const propre = !candidat || viseLApplication(candidat) ? API_PAR_DEFAUT : candidat;
    localStorage.setItem(CLE_API, propre);
    setApiBaseUrl(propre);
  }, []);

  const valeur = useMemo<ContexteI18n>(
    () => ({
      langue,
      changerLangue,
      apiBaseUrl,
      definirApiBaseUrl,
      t: (cle: string) => DICO[cle]?.[langue] ?? cle,
    }),
    [langue, changerLangue, apiBaseUrl, definirApiBaseUrl],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useI18n(): ContexteI18n {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error('useI18n doit être utilisé dans I18nProvider.');
  return contexte;
}

/** URL de base courante, lisible hors composant React (client API, synchro). */
export function apiBaseUrlCourante(): string {
  return lireApi();
}