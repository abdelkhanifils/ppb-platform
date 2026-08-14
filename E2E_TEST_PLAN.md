# Plan de tests end-to-end — par module

Scénarios end-to-end (parcours complets, plusieurs endpoints enchaînés),
complémentaires aux tests unitaires/d'intégration déjà présents dans
`backend/tests/` (111 tests, un par règle métier isolée). Format
Étant-donné/Quand/Alors. Les scénarios marqués **[implémenté]** ont une
contrepartie exécutable dans `backend/tests/test_e2e_parcours_complet.py` ;
les autres sont à dérouler manuellement (Postman/Swagger UI) ou à automatiser
selon les priorités du projet.

---

## Module 1 — Commande

**E2E-1.1 — Cycle de vie complet d'une commande jusqu'à expiration**
- Étant donné un Admin National authentifié pour son pays
- Quand il crée une commande de 200 PPB en mode centralisé
- Et qu'aucun paiement n'intervient dans les 30 jours (paramétrable)
- Alors la commande passe automatiquement au statut `expiree`
- Et aucun passeport n'est jamais attribué pour cette commande

**E2E-1.2 — Changement de mode d'impression verrouillé après paiement**
- Étant donné une commande créée en mode centralisé
- Quand le paiement est validé
- Alors toute tentative de changer le mode d'impression échoue (409)

---

## Module 2 — Paiement

**E2E-2.1 — Paiement présentiel validé par un agent CEBEVIRHA [implémenté]**
- Étant donné une commande en attente de paiement
- Quand un paiement présentiel est enregistré (`en_attente_validation`)
- Et qu'un Super Admin le valide
- Alors la commande passe à `payee` et des passeports sont attribués

> **Paiement en ligne (CinetPay) — reporté.** Les scénarios de paiement en
> ligne (initiation, webhook signé, réconciliation active) sont retirés de
> ce catalogue le temps que les identifiants CinetPay soient disponibles —
> voir le README, section « Réactiver CinetPay ». Ils réapparaîtront ici à
> la réintégration.

---

## Module 3 — Impression

**E2E-3.1 — Attribution, QR, signature et publication automatique [implémenté]**
- Étant donné une commande payée de 5 PPB
- Quand l'attribution se déclenche
- Alors 5 passeports sont créés avec numérotation séquentielle continue (pays/année/lot)
- Et chacun a un QR UUID distinct, une signature vérifiable avec la clé publique
- Et chacun est immédiatement publié (`publie_le` renseigné) vers l'index de vérification du Module 5

**E2E-3.2 — Impression décentralisée bout en bout**
- Étant donné une AutorisationImpression active (plage 1-1000) pour un pays
- Quand ce pays commande 50 PPB en mode décentralisé
- Et que l'administration déclare le lot imprimé (numéros 1 à 50)
- Alors ces 50 passeports passent de `precharge` à `vierge`
- Et une déclaration hors plage (ex. 900-950 sans commande correspondante) est rejetée sans écriture partielle

---

## Module 4 — Scan (émission terrain)

**E2E-4.1 — Parcours 4 pages complet avec création d'entités [implémenté]**
- Étant donné un passeport `vierge` et un agent d'émission de son pays
- Quand les 4 pages sont validées dans l'ordre (vérif. visuelle, scan QR, identification+itinéraire, troupeau+vaccinations)
- Alors le passeport passe à `emis`
- Et Éleveur, Convoyeur, Itinéraire, Troupeau (+ espèces), Vaccinations existent en base
- Et l'Itinéraire est publié vers l'index de vérification du Module 5

**E2E-4.2 — Résilience au rejeu (perte réseau après succès serveur) [implémenté]**
- Étant donné les 4 pages déjà validées
- Quand la page 4 est renvoyée une seconde fois (ex. réponse perdue côté client)
- Alors aucune entité n'est dupliquée (un seul Troupeau, une seule ligne Numerisation page 4)

**E2E-4.3 — Fonctionnement hors-ligne côté client (à valider manuellement)**
- Étant donné l'application d'émission avec son cache IndexedDB préchargé (schémas + passeports)
- Quand l'agent perd la connexion réseau en cours de saisie
- Alors chaque page validée reste actée localement (file de synchronisation)
- Et dès la reconnexion, la file se vide automatiquement sans action de l'agent

---

## Module 5 — Contrôle frontière

**E2E-5.1 — Contrôle valide, signature authentique, trajet conforme [implémenté]**
- Étant donné un passeport émis avec un itinéraire Cameroun → Tchad
- Quand un agent de contrôle camerounais scanne son QR
- Alors la signature est vérifiée authentique et le trajet jugé conforme (résultat `valide`)

**E2E-5.2 — Contrôle refusé, signature falsifiée [implémenté]**
- Étant donné un passeport dont la signature stockée a été altérée
- Quand un agent de contrôle le scanne
- Alors le résultat est `refuse`, sans même consulter l'itinéraire

**E2E-5.3 — Repli papier si itinéraire non encore synchronisé [implémenté]**
- Étant donné un passeport `emis` mais dont la page 3 n'a pas encore été transmise
- Quand un agent de contrôle le scanne
- Alors le résultat est `a_verifier` (jamais un blocage ni une validation par défaut)

**E2E-5.4 — Synchronisation différentielle après coupure réseau [implémenté]**
- Étant donné un poste de contrôle hors-ligne depuis 2 heures pendant que 3 passeports sont attribués et 2 itinéraires publiés ailleurs
- Quand le réseau revient
- Alors le prochain appel `/controles/cache-verification/delta?depuis=<dernière synchro>` renvoie exactement ces nouveautés, rien de plus

**E2E-5.5 — Vérification hors-ligne côté client (à valider manuellement, poste réel)**
- Étant donné l'application de contrôle avec son cache synchronisé et la clé publique en cache
- Quand l'agent scanne un QR sans connexion réseau
- Alors le résultat (signature + conformité) s'affiche immédiatement, sans attente réseau
- Et le contrôle est mis en file, remonté automatiquement à la reconnexion

---

## Module Administration

**E2E-A.1 — Propagation d'un nouveau champ dynamique jusqu'au terrain**
- Étant donné le formulaire « éleveur » à la version de schéma N
- Quand le Super Admin ajoute un nouveau champ
- Alors `schema_version` passe à N+1
- Et `GET /formulaires/eleveur/schema` renvoie immédiatement ce nouveau champ
- Et une application terrain qui rafraîchit son cache (`rafraichirSchema`) l'affiche sans mise à jour de l'app elle-même

**E2E-A.2 — Circuit à deux comptes pour TexteGabarit [implémenté]**
- Étant donné un Super Admin A qui propose un nouveau texte légal pour la version de gabarit 2
- Quand le Super Admin A tente de le valider lui-même
- Alors la validation est refusée (409)
- Quand un second Super Admin B le valide
- Alors le texte passe à `valide`, horodaté et attribué à B — jamais à A
- Et un texte déjà `valide` ne peut plus être revalidé ni rejeté

---

## Statistiques (tableau de bord régional)

**E2E-S.1 — Cohérence du tableau de bord après un cycle complet [implémenté]**
- Étant donné un cycle complet (commande → paiement → attribution → émission → contrôle) pour un pays
- Quand le tableau de bord régional est interrogé
- Alors `par_pays` reflète exactement 1 commande, le montant encaissé exact, et les passeports dans les bons statuts
- Et `entonnoir_global` reflète la même réalité tous pays confondus
- Et `par_poste` reflète le contrôle enregistré, avec le bon total

**E2E-S.2 — Carte des mouvements après plusieurs contrôles géolocalisés**
- Étant donné plusieurs contrôles enregistrés à des postes proches géographiquement
- Quand `/statistiques/carte-mouvements` est interrogé
- Alors les contrôles proches sont regroupés en un même cluster (PostGIS en production ; repli par grille en test)

---

## Récapitulatif de couverture

| Module | Scénarios définis | Implémentés (pytest) |
|---|---|---|
| Commande | 2 | 0 (couverts unitairement ailleurs) |
| Paiement | 1 | 1 |
| Impression | 2 | 1 |
| Scan | 3 | 2 |
| Contrôle | 5 | 4 |
| Administration | 2 | 1 |
| Statistiques | 2 | 1 |
| **Total** | **17** | **10** |

Les scénarios non implémentés sont soit déjà couverts par la profondeur des
tests unitaires existants (Module 1), soit nécessitent un environnement réel
(navigateur, réseau instable, vraie base PostGIS) hors de portée de la suite
pytest automatisée — signalés comme tels dans leur description. Le paiement
en ligne (CinetPay) est reporté — voir la note dans la section Module 2.
