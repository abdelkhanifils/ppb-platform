/**
 * Internationalisation FR/EN — même patron que mobile/src/lib/i18n.tsx
 * (dictionnaire de clés, hook useI18n, provider), pour que les deux
 * applications se comportent de la même façon du point de vue de l'agent :
 * un même sélecteur, une même persistance de préférence, un même principe
 * (langue de l'INTERFACE seulement — les libellés IMPRIMÉS du passeport
 * papier, ancres de l'OCR, restent en français quel que soit ce réglage).
 *
 * Ce dictionnaire démarre volontairement sur le périmètre le plus utile
 * dans l'immédiat (mise en page partagée, connexion, module Émission
 * terrain — le rôle au centre de cette évolution) ; les autres écrans
 * restent en français en dur pour l'instant et peuvent être étendus au
 * même dictionnaire au fil de l'eau, sans changer l'architecture.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Langue = "fr" | "en";

const CLE_LANGUE = "ppb_admin.langue";

type Entree = { fr: string; en: string };

const DICO: Record<string, Entree> = {
  // --- Mise en page partagée (layouts/TableauDeBordLayout.tsx) ---
  "nav.tableau_bord": { fr: "Tableau de bord", en: "Dashboard" },
  "nav.commandes": { fr: "Commandes", en: "Orders" },
  "nav.paiements": { fr: "Paiements", en: "Payments" },
  "nav.impression": { fr: "Impression", en: "Printing" },
  "nav.emission": { fr: "Émission terrain", en: "Field issuance" },
  "nav.controle": { fr: "Contrôle frontière", en: "Border control" },
  "nav.vaccinations": { fr: "Vaccinations", en: "Vaccinations" },
  "nav.administration": { fr: "Administration", en: "Administration" },
  "nav.statistiques": { fr: "Statistiques", en: "Statistics" },
  "layout.deconnexion": { fr: "Déconnexion", en: "Log out" },
  "layout.ouvrir_menu": { fr: "Ouvrir le menu", en: "Open menu" },
  "layout.fermer_menu": { fr: "Fermer le menu", en: "Close menu" },
  "notifications.titre": { fr: "Notifications", en: "Notifications" },
  "notifications.aucune": { fr: "Aucune notification.", en: "No notifications." },
  "notifications.tout_marquer_lu": { fr: "Tout marquer comme lu", en: "Mark all as read" },

  // --- Connexion (pages/Connexion.tsx) ---
  "connexion.organisme": { fr: "CEBEVIRHA — Plateforme numérique du PPB", en: "CEBEVIRHA — PPB digital platform" },
  "connexion.email": { fr: "Email", en: "Email" },
  "connexion.mot_de_passe": { fr: "Mot de passe", en: "Password" },
  "connexion.se_connecter": { fr: "Se connecter", en: "Log in" },
  "connexion.en_cours": { fr: "Connexion…", en: "Logging in…" },
  "connexion.erreur": { fr: "Email ou mot de passe incorrect.", en: "Incorrect email or password." },
  "connexion.hors_ligne_premiere_fois": {
    fr: "Pas de connexion réseau. La toute première connexion sur cet appareil nécessite Internet (le mot de passe doit être vérifié) ; une fois connecté une première fois, vous pourrez rouvrir l'application hors-ligne.",
    en: "No network connection. The very first login on this device requires internet (the password must be verified); once logged in once, you'll be able to reopen the app offline.",
  },

  // --- Sélecteur de langue ---
  "langue.libelle": { fr: "Langue", en: "Language" },
  "langue.francais": { fr: "Français", en: "French" },
  "langue.anglais": { fr: "English", en: "English" },

  // --- Module 4 — Émission terrain (pages/EmissionTerrain.tsx + emission/*) ---
  "emission.titre": { fr: "Émission terrain", en: "Field issuance" },
  "emission.succes": { fr: "Passeport {numero} enregistré avec succès — prêt pour le suivant.", en: "Passport {numero} saved successfully — ready for the next one." },
  "emission.page_sur": { fr: "Page {page} sur 4", en: "Page {page} of 4" },
  "emission.annuler": { fr: "Annuler", en: "Cancel" },
  "emission.liste_repliee": { fr: "Pas le document sous la main ? Choisir dans la liste préchargée", en: "Don't have the document at hand? Choose from the preloaded list" },
  "emission.actualiser": { fr: "Actualiser", en: "Refresh" },
  "emission.liste_vide": { fr: "Aucun passeport préchargé localement. Connectez-vous puis actualisez.", en: "No passport preloaded locally. Connect then refresh." },
  "emission.reprendre": { fr: "Reprendre →", en: "Resume →" },

  "sync.en_ligne": { fr: "En ligne", en: "Online" },
  "sync.en_cours": { fr: "Synchronisation en cours…", en: "Syncing…" },
  "sync.hors_ligne": { fr: "Hors-ligne — les saisies sont conservées localement", en: "Offline — entries are kept locally" },
  "sync.voir_detail": { fr: "Voir le détail", en: "Show details" },
  "sync.masquer_detail": { fr: "Masquer le détail", en: "Hide details" },
  "sync.en_echec": { fr: "{n} en échec — réessayer", en: "{n} failed — retry" },
  "sync.erreur_inconnue": { fr: "Erreur inconnue", en: "Unknown error" },
  "sync.page_passeport": { fr: "Page {page} — passeport {id}… ({n} tentative{s})", en: "Page {page} — passport {id}… ({n} attempt{s})" },

  "page1.titre": { fr: "1 · Vérification visuelle", en: "1 · Visual check" },
  "page1.intro": { fr: "Contrôlez le document physique avant de continuer — aucune photo n'est prise à cette étape.", en: "Check the physical document before continuing — no photo is taken at this step." },
  "page1.critere_numero": { fr: "Le numéro imprimé correspond au lot remis (Pays-Année-N° de lot)", en: "The printed number matches the batch handed over (Country-Year-Batch No.)" },
  "page1.critere_qr": { fr: "Le QR Code de validation est présent et net", en: "The validation QR Code is present and clear" },
  "page1.critere_zone": { fr: "La zone de lecture automatique n'est pas endommagée", en: "The automatic reading zone is not damaged" },
  "page1.critere_securite": { fr: "Le guilloché et les éléments de sécurité sont visibles", en: "The guilloche pattern and security features are visible" },
  "page1.valider": { fr: "Document conforme — continuer", en: "Document compliant — continue" },
  "page1.validation": { fr: "Validation…", en: "Saving…" },

  "page2.titre": { fr: "Scan du QR Code", en: "QR Code scan" },
  "page2.intro": { fr: "Visez le QR Code de validation en page 2 du document.", en: "Aim at the validation QR Code on page 2 of the document." },
  "page2.verification": { fr: "Vérification…", en: "Checking…" },
  "page2.camera_indisponible": { fr: "Caméra indisponible — utilisez la saisie manuelle ci-dessous.", en: "Camera unavailable — use the manual entry below." },
  "page2.aucun_passeport": { fr: "Ce QR ne correspond à aucun passeport préchargé pour vous. Rafraîchissez la liste si vous êtes en ligne.", en: "This QR doesn't match any passport preloaded for you. Refresh the list if you're online." },
  "page2.saisie_manuelle": { fr: "Caméra indisponible ? Saisie manuelle", en: "Camera unavailable? Manual entry" },
  "page2.placeholder_uuid": { fr: "UUID du QR Code", en: "QR Code UUID" },
  "page2.valider": { fr: "Valider", en: "Confirm" },

  "page3.titre": { fr: "3 · Éleveur, convoyeur et itinéraire", en: "3 · Owner, conveyor and route" },
  "page3.proprietaire": { fr: "Propriétaire", en: "Owner" },
  "page3.convoyeur": { fr: "Convoyeur", en: "Conveyor" },
  "page3.nom_prenom": { fr: "Nom et prénom", en: "Full name" },
  "page3.nom_prenom_oblig": { fr: "Nom et prénom *", en: "Full name *" },
  "page3.cni": { fr: "N° CNI", en: "ID card no." },
  "page3.cni_oblig": { fr: "N° CNI *", en: "ID card no. *" },
  "page3.telephone": { fr: "Téléphone", en: "Phone" },
  "page3.itineraire": { fr: "Itinéraire déclaré", en: "Declared route" },
  "page3.itineraire_intro": { fr: "Déclaré oralement par l'éleveur ou le convoyeur — détermine à lui seul la validité du passeport pour ce trajet.", en: "Declared orally by the owner or conveyor — alone determines the passport's validity for this route." },
  "page3.pays_origine": { fr: "Pays d'origine", en: "Country of origin" },
  "page3.pays_autre": { fr: "Autres (hors CEMAC)", en: "Other (outside CEMAC)" },
  "page3.pays_origine_autre": { fr: "Nom du pays d'origine", en: "Country of origin name" },
  "page3.pays_destination_autre": { fr: "Nom du pays de destination", en: "Country of destination name" },
  "page3.pays_destination": { fr: "Pays de destination", en: "Country of destination" },
  "page3.province_origine": { fr: "Province d'origine *", en: "Province of origin *" },
  "page3.province_destination": { fr: "Province de destination *", en: "Province of destination *" },
  "page3.localite_origine": { fr: "Localité d'origine", en: "Locality of origin" },
  "page3.localite_destination": { fr: "Localité de destination", en: "Locality of destination" },
  "page3.obligatoire": { fr: "Obligatoire", en: "Required" },
  "page3.valider": { fr: "Valider cette page", en: "Confirm this page" },
  "page3.validation": { fr: "Validation…", en: "Saving…" },

  "page4.titre": { fr: "4 · Composition du troupeau et vaccinations", en: "4 · Herd composition and vaccinations" },
  "page4.composition": { fr: "Composition par espèce", en: "Composition by species" },
  "page4.espece": { fr: "Espèce", en: "Species" },
  "page4.males": { fr: "Mâles", en: "Males" },
  "page4.femelles_jeunes": { fr: "Femelles jeunes", en: "Young females" },
  "page4.femelles_adultes": { fr: "Femelles adultes", en: "Adult females" },
  "page4.total": { fr: "Total", en: "Total" },
  "page4.ajouter_espece": { fr: "Ajouter une espèce", en: "Add a species" },
  "page4.effectif_vide": { fr: "Au moins une espèce doit avoir un effectif non nul.", en: "At least one species must have a non-zero count." },
  "page4.vaccinations": { fr: "Vaccinations réalisées ou vérifiées", en: "Vaccinations performed or checked" },
  "page4.lieu": { fr: "Lieu", en: "Location" },
  "page4.complementaires": { fr: "Informations complémentaires", en: "Additional information" },
  "page4.valider": { fr: "Valider et clôturer l'émission", en: "Confirm and complete issuance" },
  "page4.validation": { fr: "Validation…", en: "Saving…" },
  "page4.bovins": { fr: "Bovins", en: "Cattle" },
  "page4.ovins": { fr: "Ovins", en: "Sheep" },
  "page4.caprins": { fr: "Caprins", en: "Goats" },
  "page4.camelins": { fr: "Camelins", en: "Camels" },
  "page4.autres": { fr: "Autres", en: "Other" },
  "page4.peste_petits_ruminants": { fr: "Peste des Petits Ruminants", en: "Peste des Petits Ruminants" },
  "page4.peripneumonie": { fr: "Péripneumonie contagieuse", en: "Contagious pleuropneumonia" },
  "page4.charbon": { fr: "Charbon", en: "Anthrax" },
  "page4.trypanosomiase": { fr: "Trypanosomiase", en: "Trypanosomiasis" },

  // --- Commun (partagé entre plusieurs écrans) ---
  "commun.chargement": { fr: "Chargement…", en: "Loading…" },
  "commun.pays": { fr: "Pays", en: "Country" },
  "action.annuler": { fr: "Annuler", en: "Cancel" },
  "action.continuer": { fr: "Continuer", en: "Continue" },
  "action.creer": { fr: "Créer", en: "Create" },

  // --- Accès refusé (pages/AccesRefuse.tsx) ---
  "acces_refuse.titre": { fr: "Accès refusé", en: "Access denied" },
  "acces_refuse.texte": { fr: "Votre rôle ne permet pas d'accéder à cette page.", en: "Your role does not allow access to this page." },
  "acces_refuse.retour": { fr: "Retour au tableau de bord", en: "Back to dashboard" },

  // --- Vaccinations (pages/Vaccinations.tsx) ---
  "vaccinations.description": { fr: "Validation des informations sanitaires et certificats de vaccination.", en: "Validation of health information and vaccination certificates." },
  "vaccinations.a_implementer": { fr: "Écran à implémenter — structure de route déjà branchée et protégée par rôle.", en: "Screen to be implemented — route already wired and role-protected." },

  // --- Contrôle frontière (pages/ControleFrontiere.tsx) ---
  "controle.aucun_passeport": { fr: "Ce QR ne correspond à aucun passeport connu localement. Synchronisez si vous êtes en ligne.", en: "This QR doesn't match any passport known locally. Sync if you're online." },
  "controle.cle_indisponible": { fr: "Clé publique de vérification indisponible localement — synchronisez avant de continuer.", en: "Verification public key unavailable locally — sync before continuing." },
  "controle.identification_poste": { fr: "Identification du poste", en: "Post identification" },
  "controle.identification_intro": { fr: "Renseignez l'identifiant de ce poste de contrôle avant de commencer.", en: "Enter this control post's identifier before starting." },
  "controle.poste": { fr: "Poste : {id}", en: "Post: {id}" },
  "controle.changer_poste": { fr: "Changer de poste", en: "Change post" },
  "controle.suivant": { fr: "Contrôle suivant", en: "Next check" },
  "controle.deja_scanne_ce_poste": { fr: "Ce PPB a déjà été scanné {n} fois à ce poste.", en: "This PPB has already been scanned {n} time(s) at this post." },
  "controle.verifiez_document_physique": { fr: "Vérifiez attentivement le document physique et le troupeau avant de continuer.", en: "Carefully check the physical document and the herd before continuing." },
  "controle.motif_obligatoire_titre": { fr: "Motif obligatoire", en: "Reason required" },
  "controle.motif_obligatoire_explication": { fr: "Ce PPB a déjà été scanné à ce poste il y a plus de 10 minutes. Indiquez pourquoi vous validez ce passage avant de continuer.", en: "This PPB was already scanned at this post more than 10 minutes ago. State why you are validating this crossing before continuing." },
  "controle.motif_placeholder": { fr: "Ex. : le troupeau a dû rebrousser chemin pour...", en: "E.g.: the herd had to turn back because..." },
  "controle.confirmer_avec_motif": { fr: "Confirmer avec ce motif", en: "Confirm with this reason" },
  "controle.verification_en_cours": { fr: "Vérification en cours…", en: "Checking…" },
  "controle.reessayer": { fr: "Réessayer", en: "Retry" },
  "controle.placeholder_poste": { fr: "Ex. poste-kousseri", en: "E.g. post-kousseri" },
  "controle.hors_ligne": { fr: "Hors-ligne — vérifications locales toujours actives", en: "Offline — local checks still active" },
  "controle.en_attente_envoi": { fr: "{n} en attente d'envoi", en: "{n} awaiting upload" },

  // --- Commandes (pages/Commandes.tsx) ---
  "commandes.description": { fr: "Passer et suivre les commandes de PPB.", en: "Place and track PPB orders." },
  "commandes.erreur_chargement": { fr: "Impossible de charger les commandes.", en: "Unable to load orders." },
  "commandes.nouvelle": { fr: "Nouvelle commande", en: "New order" },
  "commandes.quantite": { fr: "Quantité", en: "Quantity" },
  "commandes.langue": { fr: "Langue", en: "Language" },
  "commandes.montant": { fr: "Montant (XAF)", en: "Amount (XAF)" },
  "commandes.statut": { fr: "Statut", en: "Status" },
  "commandes.responsable": { fr: "Responsable", en: "Responsible party" },
  "commandes.aucune": { fr: "Aucune commande pour l'instant.", en: "No orders yet." },
  "commandes.facture_pdf": { fr: "Facture PDF", en: "PDF invoice" },
  "commandes.bon_commande_pdf": { fr: "Bon de commande PDF", en: "PDF purchase order" },
  "commandes.echec": { fr: "Échec", en: "Failed" },
  "commandes.responsable_oblig": { fr: "Le nom du responsable est obligatoire.", en: "The responsible party's name is required." },
  "commandes.pays_oblig": { fr: "Le pays est obligatoire.", en: "The country is required." },
  "commandes.creation_echouee": { fr: "La création a échoué — vérifiez les valeurs saisies.", en: "Creation failed — check the values entered." },
  "commandes.version_linguistique": { fr: "Version linguistique", en: "Language version" },
  "commandes.mode_impression": { fr: "Mode d'impression", en: "Printing mode" },
  "commandes.centralisee": { fr: "Centralisée", en: "Centralized" },
  "commandes.decentralisee": { fr: "Décentralisée", en: "Decentralized" },
  "commandes.placeholder_responsable": { fr: "Nom du responsable de la commande", en: "Name of the person responsible for the order" },
  "commandes.creation_en_cours": { fr: "Création…", en: "Creating…" },
  "commandes.creer": { fr: "Créer la commande", en: "Create order" },

  // --- Paiements (pages/Paiements.tsx) ---
  "paiements.description": { fr: "Enregistrement et validation des paiements présentiel/virement.", en: "Recording and validation of in-person/transfer payments." },
  "paiements.aucune_commande": { fr: "Aucune commande à traiter.", en: "No orders to process." },
  "paiements.selectionner": { fr: "Sélectionnez une commande à gauche.", en: "Select an order on the left." },
  "paiements.enregistrement_echoue": { fr: "L'enregistrement a échoué.", en: "Saving failed." },
  "paiements.validation_echouee": { fr: "La validation a échoué.", en: "Validation failed." },
  "paiements.montant_du": { fr: "Montant dû : {montant} XAF", en: "Amount due: {montant} XAF" },
  "paiements.statut_commande": { fr: "Statut de la commande : {statut}", en: "Order status: {statut}" },
  "paiements.enregistres": { fr: "Paiements enregistrés", en: "Recorded payments" },
  "paiements.aucun": { fr: "Aucun paiement enregistré pour l'instant.", en: "No payment recorded yet." },
  "paiements.valider": { fr: "Valider", en: "Confirm" },
  "paiements.nouveau": { fr: "Enregistrer un nouveau paiement", en: "Record a new payment" },
  "paiements.virement": { fr: "Virement", en: "Bank transfer" },
  "paiements.especes": { fr: "Espèces", en: "Cash" },
  "paiements.cheque": { fr: "Chèque", en: "Cheque" },
  "paiements.enregistrer": { fr: "Enregistrer", en: "Save" },

  // --- Impression (pages/Impression.tsx) ---
  "impression.description": { fr: "Confirmer l'impression des commandes payées.", en: "Confirm printing of paid orders." },
  "impression.commandes_payees": { fr: "Commandes payées", en: "Paid orders" },
  "impression.aucune_en_attente": { fr: "Aucune commande payée en attente d'impression.", en: "No paid order awaiting printing." },
  "impression.document_echoue": { fr: "Le document n'a pas pu être généré — réessayez, ou signalez ce blocage.", en: "The document could not be generated — try again, or report this issue." },
  "impression.mode": { fr: "Mode : {mode}", en: "Mode: {mode}" },
  "impression.nb_disponibles": { fr: "{n} passeport(s) disponible(s)", en: "{n} passport(s) available" },
  "impression.nombre_a_afficher": { fr: "Nombre à afficher :", en: "Number to display:" },
  "impression.ouvrir_pdf": { fr: "Ouvrir le PDF", en: "Open PDF" },
  "impression.imprimez_puis_declarez": { fr: "Imprimez le document téléchargé ci-dessus, puis déclarez le lot réellement imprimé dans la section ci-dessous.", en: "Print the document downloaded above, then declare the actually printed batch in the section below." },
  "impression.autorisations_titre": { fr: "Autorisations d'impression décentralisée", en: "Decentralized printing authorizations" },
  "impression.nouvelle_autorisation": { fr: "+ Nouvelle autorisation", en: "+ New authorization" },
  "impression.plage": { fr: "Plage {debut}–{fin} (gabarit v{version})", en: "Range {debut}–{fin} (template v{version})" },
  "impression.suspendre": { fr: "Suspendre", en: "Suspend" },
  "impression.aucune_autorisation": { fr: "Aucune autorisation active", en: "No active authorization" },
  "impression.creation_echouee": { fr: "La création a échoué.", en: "Creation failed." },
  "impression.numero_debut": { fr: "Numéro début", en: "Start number" },
  "impression.numero_fin": { fr: "Numéro fin", en: "End number" },
  "impression.version_gabarit": { fr: "Version gabarit", en: "Template version" },
  "impression.declarer_lot_titre": { fr: "Déclarer un lot imprimé (impression décentralisée)", en: "Declare a printed batch (decentralized printing)" },
  "impression.declarer_lot_intro": {
    fr: "À utiliser une fois le lot physiquement imprimé localement, dans la plage autorisée pour le pays. Rejeté en bloc si un numéro de la plage est manquant ou déjà imprimé.",
    en: "Use once the batch is physically printed locally, within the range authorized for the country. Rejected entirely if a number in the range is missing or already printed.",
  },
  "impression.declarer": { fr: "Déclarer", en: "Declare" },
  "impression.declare_succes": { fr: "{n} passeport(s) déclaré(s) imprimé(s) — passés au statut \"vierge\".", en: "{n} passport(s) declared printed — moved to \"blank\" status." },
  "impression.declaration_echouee": { fr: "La déclaration a échoué.", en: "Declaration failed." },

  // --- Statistiques (pages/Statistiques.tsx) ---
  "statistiques.erreur_chargement": { fr: "Impossible de charger le tableau de bord.", en: "Unable to load the dashboard." },
  "statistiques.chargement_tdb": { fr: "Chargement du tableau de bord…", en: "Loading dashboard…" },
  "statistiques.donnees_indisponibles": { fr: "Données indisponibles.", en: "Data unavailable." },
  "statistiques.titre": { fr: "Tableau de bord régional", en: "Regional dashboard" },
  "statistiques.resume": { fr: "{pays} pays · {commandes} commandes · {montant} XAF encaissés", en: "{pays} countries · {commandes} orders · {montant} XAF collected" },
  "statistiques.entonnoir_titre": { fr: "Entonnoir global — par phase du pipeline", en: "Global funnel — by pipeline phase" },
  "statistiques.par_pays_titre": { fr: "Par pays — commandes et passeports émis/contrôlés", en: "By country — orders and issued/checked passports" },
  "statistiques.emis": { fr: "Émis", en: "Issued" },
  "statistiques.controles": { fr: "Contrôlés", en: "Checked" },
  "statistiques.par_poste_titre": { fr: "Par poste de contrôle", en: "By control post" },
  "statistiques.poste": { fr: "Poste", en: "Post" },
  "statistiques.total": { fr: "Total", en: "Total" },
  "statistiques.valides": { fr: "Validés", en: "Passed" },
  "statistiques.refuses": { fr: "Refusés", en: "Failed" },
  "statistiques.a_verifier": { fr: "À vérifier", en: "To review" },
  "statistiques.aucun_poste": { fr: "Aucun poste référencé pour l'instant.", en: "No post registered yet." },
  "statistiques.detail_titre": { fr: "Détail par pays et par année", en: "Detail by country and year" },
  "statistiques.detail_intro": { fr: "Commandes, paiements (par moyen), passeports (par statut) et contrôles (par résultat).", en: "Orders, payments (by method), passports (by status) and checks (by outcome)." },
  "statistiques.section_echouee": { fr: "Cette section n'a pas pu être chargée — le reste du tableau de bord reste disponible.", en: "This section could not be loaded — the rest of the dashboard is still available." },
  "statistiques.carte_titre": { fr: "Carte des mouvements — clusters de contrôle", en: "Movement map — control clusters" },
  "statistiques.carte_intro": { fr: "Regroupement géospatial (PostGIS en production) des contrôles enregistrés. Taille du cercle proportionnelle au volume ; couleur selon la proportion de résultats validés.", en: "Geospatial clustering (PostGIS in production) of recorded checks. Circle size proportional to volume; color based on the share of passed results." },
  "statistiques.aucun_controle_geo": { fr: "Aucun contrôle géolocalisé pour l'instant.", en: "No geolocated check yet." },
  "statistiques.n_controles": { fr: "{n} contrôle(s)", en: "{n} check(s)" },
  "statistiques.tous_pays": { fr: "Tous les pays", en: "All countries" },
  "statistiques.annee": { fr: "Année", en: "Year" },
  "statistiques.toutes_annees": { fr: "Toutes les années", en: "All years" },
  "statistiques.toutes_f": { fr: "Toutes", en: "All" },
  "statistiques.exporter": { fr: "Exporter", en: "Export" },
  "statistiques.generation": { fr: "Génération…", en: "Generating…" },
  "statistiques.exporter_excel": { fr: "Exporter en Excel", en: "Export to Excel" },
  "statistiques.export_echoue": { fr: "L'export a échoué — réessayez.", en: "Export failed — try again." },
  "statistiques.export_emis": { fr: "Passeports émis", en: "Issued passports" },
  "statistiques.export_controles": { fr: "Passeports vérifiés (contrôles)", en: "Checked passports (controls)" },
  "statistiques.montant_commande": { fr: "Montant commandé", en: "Ordered amount" },
  "statistiques.montant_encaisse": { fr: "Montant encaissé", en: "Collected amount" },
  "statistiques.moyens_paiement": { fr: "Moyens de paiement", en: "Payment methods" },
  "statistiques.vierge": { fr: "Vierge", en: "Blank" },
  "statistiques.controle": { fr: "Contrôlé", en: "Checked" },
  "statistiques.verifs_validees": { fr: "Vérifs. validées", en: "Passed checks" },
  "statistiques.refusees": { fr: "Refusées", en: "Failed" },
  "statistiques.aucune_donnee": { fr: "Aucune donnée pour ce filtre.", en: "No data for this filter." },
  "statistiques.erreur_emissions": { fr: "Impossible de charger le détail des émissions.", en: "Unable to load issuance details." },
  "statistiques.emissions_titre": { fr: "Détail des émissions — éleveurs, convoyeurs, troupeaux", en: "Issuance details — owners, conveyors, herds" },
  "statistiques.emissions_intro": {
    fr: "Identité (nom, N° CNI, téléphone) de l'éleveur et du convoyeur, composition du troupeau par espèce et vaccinations enregistrées, pour chaque passeport effectivement émis sur le terrain.",
    en: "Identity (name, ID No., phone) of the owner and conveyor, herd composition by species and recorded vaccinations, for each passport actually issued in the field.",
  },
  "statistiques.aucune_emission": { fr: "Aucune émission pour ce filtre.", en: "No issuance for this filter." },
  "statistiques.tetes": { fr: "{n} tête(s)", en: "{n} head" },
  "statistiques.cni": { fr: "CNI", en: "ID No." },
  "statistiques.tel": { fr: "Tél.", en: "Tel." },
  "statistiques.non_renseigne": { fr: "Non renseigné.", en: "Not provided." },
  "statistiques.especes": { fr: "Espèces", en: "Species" },
  "statistiques.detail_effectif": { fr: "{total} (mâles {males}, femelles jeunes {fj}, femelles adultes {fa})", en: "{total} (males {males}, young females {fj}, adult females {fa})" },
  "statistiques.validee": { fr: "validée", en: "confirmed" },
  "statistiques.non_validee": { fr: "non validée", en: "not confirmed" },
};

/** Remplace {cle} dans une chaîne traduite par la valeur fournie —
 * interpolation minimale, pas de dépendance externe. */
export function interpoler(texte: string, valeurs: Record<string, string | number>): string {
  return texte.replace(/\{(\w+)\}/g, (correspondance, cle) => String(valeurs[cle] ?? correspondance));
}

interface ContexteI18n {
  langue: Langue;
  changerLangue: (l: Langue) => void;
  t: (cle: string, valeurs?: Record<string, string | number>) => string;
}

const Contexte = createContext<ContexteI18n | null>(null);

function lireLangue(): Langue {
  if (typeof localStorage === "undefined") return "fr";
  return localStorage.getItem(CLE_LANGUE) === "en" ? "en" : "fr";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [langue, setLangue] = useState<Langue>(lireLangue);

  useEffect(() => {
    document.documentElement.lang = langue;
  }, [langue]);

  const changerLangue = useCallback((l: Langue) => {
    localStorage.setItem(CLE_LANGUE, l);
    setLangue(l);
  }, []);

  const valeur = useMemo<ContexteI18n>(
    () => ({
      langue,
      changerLangue,
      t: (cle, valeurs) => {
        const brut = DICO[cle]?.[langue] ?? cle;
        return valeurs ? interpoler(brut, valeurs) : brut;
      },
    }),
    [langue, changerLangue]
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useI18n(): ContexteI18n {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useI18n doit être utilisé dans I18nProvider.");
  return contexte;
}
