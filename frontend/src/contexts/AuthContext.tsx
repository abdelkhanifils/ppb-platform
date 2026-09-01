import React, { createContext, useContext, useEffect, useState } from "react";
import { AxiosError } from "axios";
import { apiClient, tokenStorage } from "@/api/client";
import { aUnVerrouPour, enregistrerVerificationLocale, verifierLocalement } from "@/lib/verrouLocal";
import type { Utilisateur } from "@/types/roles";

interface AuthContextValue {
  utilisateur: Utilisateur | null;
  chargement: boolean;
  horsLigne: boolean;
  connecter: (email: string, motDePasse: string) => Promise<void>;
  deconnecter: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface SessionCache {
  utilisateur: Utilisateur;
  access_token: string;
  refresh_token: string;
}

// Sessions mises en cache PAR COMPTE (dictionnaire indexé par email) — c'est
// ce qui permet de rouvrir l'app hors-ligne sans dépendre d'un aller-retour
// réseau (voir chargerUtilisateurCourant ci-dessous). Corrigé après un bug
// réel constaté en production : un cache unique global était écrasé par
// chaque nouvelle connexion, rendant la reconnexion hors-ligne impossible
// dès qu'un second compte se connectait sur le même appareil (poste
// partagé, ou test avec plusieurs comptes) — parfois avec un jeton du
// MAUVAIS compte restitué silencieusement. Chaque compte garde maintenant sa
// propre entrée (profil + jetons), indéfiniment tant qu'il ne s'est pas
// reconnecté en ligne entre-temps.
const CLE_SESSIONS_CACHE = "ppb_sessions_cache";
// Pointeur léger vers le compte actuellement actif dans cet onglet — utile
// uniquement pour la continuité hors-ligne d'une session déjà ouverte (le
// jeton seul ne permet pas de retrouver l'email correspondant sans lui).
const CLE_EMAIL_ACTIF = "ppb_email_actif";

function lireTableSessions(): Record<string, SessionCache> {
  try {
    const brut = localStorage.getItem(CLE_SESSIONS_CACHE);
    return brut ? (JSON.parse(brut) as Record<string, SessionCache>) : {};
  } catch {
    return {};
  }
}

function ecrireSessionCache(email: string, session: SessionCache): void {
  const table = lireTableSessions();
  table[email.trim().toLowerCase()] = session;
  localStorage.setItem(CLE_SESSIONS_CACHE, JSON.stringify(table));
  localStorage.setItem(CLE_EMAIL_ACTIF, email.trim().toLowerCase());
}

function lireSessionCache(email: string): SessionCache | null {
  return lireTableSessions()[email.trim().toLowerCase()] ?? null;
}

function effacerSessionCache(email: string): void {
  const table = lireTableSessions();
  delete table[email.trim().toLowerCase()];
  localStorage.setItem(CLE_SESSIONS_CACHE, JSON.stringify(table));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);

  /**
   * Point central du mode hors-ligne pour l'authentification : un jeton
   * déjà stocké (connexion précédente réussie, en ligne) suffit à rouvrir
   * l'app sans réseau. La vérification serveur (/auth/moi) reste tentée à
   * chaque chargement pour rafraîchir le profil et détecter une vraie
   * expiration, mais son ÉCHEC RÉSEAU (hors-ligne, DNS, serveur injoignable
   * — pas de réponse HTTP du tout) ne déconnecte JAMAIS l'agent : on retombe
   * sur le profil mis en cache localement pour le compte actif lors de la
   * dernière connexion réussie. Seul un vrai 401 (le serveur confirme
   * explicitement que le jeton est invalide/expiré) efface la session — la
   * seule situation où rester "connecté" localement n'aurait aucun sens.
   */
  const chargerUtilisateurCourant = async () => {
    try {
      const { data } = await apiClient.get<Utilisateur>("/auth/moi");
      setUtilisateur(data);
      setHorsLigne(false);
      ecrireSessionCache(data.email, {
        utilisateur: data,
        access_token: tokenStorage.getAccess() ?? "",
        refresh_token: tokenStorage.getRefresh() ?? "",
      });
    } catch (err) {
      const erreur = err as AxiosError;
      if (erreur.response?.status === 401) {
        // Le serveur a explicitement rejeté le jeton : session réellement invalide.
        const emailActif = localStorage.getItem(CLE_EMAIL_ACTIF);
        tokenStorage.clear();
        if (emailActif) effacerSessionCache(emailActif);
        setUtilisateur(null);
        setHorsLigne(false);
      } else {
        // Pas de réponse du tout (hors-ligne, serveur injoignable, CORS...) :
        // on ne sait pas si le jeton est valide, donc on NE déconnecte PAS —
        // on retombe sur le compte actif mis en cache.
        const emailActif = localStorage.getItem(CLE_EMAIL_ACTIF);
        const cache = emailActif ? lireSessionCache(emailActif) : null;
        setUtilisateur(cache?.utilisateur ?? null);
        setHorsLigne(true);
      }
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => {
    if (tokenStorage.getAccess()) {
      chargerUtilisateurCourant();
    } else {
      setChargement(false);
    }
  }, []);

  const connecter = async (email: string, motDePasse: string) => {
    try {
      const { data } = await apiClient.post("/auth/login", { email, password: motDePasse });
      tokenStorage.set(data.access_token, data.refresh_token);
      // Empreinte locale mise à jour à CHAQUE connexion en ligne réussie —
      // c'est elle qui permettra une reconnexion hors-ligne ultérieure avec
      // ce même mot de passe, POUR CE COMPTE PRÉCIS (voir la branche réseau
      // ci-dessous, et src/lib/verrouLocal.ts pour le détail de ce qui est
      // stocké — désormais un dictionnaire par compte, pas un verrou unique).
      await enregistrerVerificationLocale(email, motDePasse);
      await chargerUtilisateurCourant();
      return;
    } catch (err) {
      const erreurAxios = err as AxiosError;
      if (erreurAxios.response) {
        // Le serveur a répondu (401, etc.) : identifiants réellement incorrects.
        throw err;
      }
      // Pas de réponse du tout : coupure réseau. Dernière chance — une
      // session complète (jetons + profil) DE CE COMPTE PRÉCIS doit déjà
      // être en cache (connexion en ligne réussie avant une déconnexion, ou
      // avant l'expiration du jeton), ET le mot de passe saisi doit
      // correspondre à l'empreinte enregistrée pour ce même compte (voir
      // ./verrouLocal.ts, désormais indexé par email — un autre compte
      // connecté entre-temps sur cet appareil n'efface plus cette entrée).
      // On ne peut JAMAIS obtenir de nouveaux jetons hors-ligne — c'est LA
      // SESSION DE CE COMPTE, restituée telle quelle, jetons compris (pas
      // ceux d'un compte différent qui serait actif à cet instant).
      const motDePasseValide = await verifierLocalement(email, motDePasse);
      const sessionCache = lireSessionCache(email);
      if (motDePasseValide && sessionCache) {
        tokenStorage.set(sessionCache.access_token, sessionCache.refresh_token);
        localStorage.setItem(CLE_EMAIL_ACTIF, email.trim().toLowerCase());
        setUtilisateur(sessionCache.utilisateur);
        setHorsLigne(true);
        return;
      }
      if (aUnVerrouPour(email)) {
        // Déjà connecté avec succès sur cet appareil, mais le mot de passe
        // saisi ne correspond pas à l'empreinte enregistrée — la vérifier
        // ne nécessite PAS le réseau, donc ce n'est pas un problème de
        // connectivité : le mot de passe est vraiment incorrect.
        throw new Error("PPB_MOT_DE_PASSE_INCORRECT_LOCAL");
      }
      throw err;
    }
  };

  const deconnecter = () => {
    // Verrouille l'app (retour à l'écran de connexion) SANS effacer le
    // jeton, le profil en cache ni l'empreinte du mot de passe : c'est ce
    // qui permet à l'agent de se reconnecter hors-ligne juste après, avec
    // son mot de passe habituel (voir `connecter` ci-dessus). Une
    // déconnexion "complète" (effacement total, ex. changement d'agent sur
    // un même appareil partagé) resterait à ajouter comme action séparée si
    // besoin — volontairement pas fait ici pour ne pas la confondre avec
    // une simple déconnexion.
    setUtilisateur(null);
    setHorsLigne(false);
  };

  return (
    <AuthContext.Provider value={{ utilisateur, chargement, horsLigne, connecter, deconnecter }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'un <AuthProvider>.");
  return ctx;
}
