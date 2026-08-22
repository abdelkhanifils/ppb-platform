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

// Profil mis en cache localement après chaque connexion/vérification réussie
// — c'est ce qui permet de rouvrir l'app hors-ligne : on ne dépend plus
// d'un aller-retour réseau pour savoir "qui est connecté", seulement d'un
// jeton déjà présent (voir chargerUtilisateurCourant ci-dessous).
const CLE_UTILISATEUR_CACHE = "ppb_utilisateur_cache";

function lireUtilisateurCache(): Utilisateur | null {
  try {
    const brut = localStorage.getItem(CLE_UTILISATEUR_CACHE);
    return brut ? (JSON.parse(brut) as Utilisateur) : null;
  } catch {
    return null;
  }
}

function ecrireUtilisateurCache(utilisateur: Utilisateur): void {
  localStorage.setItem(CLE_UTILISATEUR_CACHE, JSON.stringify(utilisateur));
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
   * sur le profil mis en cache localement lors de la dernière connexion
   * réussie. Seul un vrai 401 (le serveur confirme explicitement que le
   * jeton est invalide/expiré) efface la session — c'est la seule situation
   * où rester "connecté" localement n'aurait aucun sens.
   */
  const chargerUtilisateurCourant = async () => {
    try {
      const { data } = await apiClient.get<Utilisateur>("/auth/moi");
      setUtilisateur(data);
      setHorsLigne(false);
      ecrireUtilisateurCache(data);
    } catch (err) {
      const erreur = err as AxiosError;
      if (erreur.response?.status === 401) {
        // Le serveur a explicitement rejeté le jeton : session réellement invalide.
        tokenStorage.clear();
        localStorage.removeItem(CLE_UTILISATEUR_CACHE);
        setUtilisateur(null);
        setHorsLigne(false);
      } else {
        // Pas de réponse du tout (hors-ligne, serveur injoignable, CORS...) :
        // on ne sait pas si le jeton est valide, donc on NE déconnecte PAS.
        const cache = lireUtilisateurCache();
        setUtilisateur(cache);
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
      // ce même mot de passe (voir la branche réseau ci-dessous, et
      // src/lib/verrouLocal.ts pour le détail de ce qui est stocké).
      await enregistrerVerificationLocale(email, motDePasse);
      await chargerUtilisateurCourant();
      return;
    } catch (err) {
      const erreurAxios = err as AxiosError;
      if (erreurAxios.response) {
        // Le serveur a répondu (401, etc.) : identifiants réellement incorrects.
        throw err;
      }
      // Pas de réponse du tout : coupure réseau. Dernière chance — un jeton
      // ET un profil déjà présents localement (connexion en ligne réussie
      // avant une déconnexion, ou avant l'expiration du jeton), combinés à
      // une empreinte de mot de passe qui correspond : on rouvre l'app avec
      // ces données, sans jamais obtenir de nouveau jeton (impossible sans
      // serveur) — la prochaine requête réelle validera silencieusement le
      // jeton existant, ou déclenchera une vraie reconnexion s'il a expiré.
      const motDePasseValide = await verifierLocalement(email, motDePasse);
      const jetonExistant = tokenStorage.getAccess();
      const profilCache = lireUtilisateurCache();
      if (motDePasseValide && jetonExistant && profilCache) {
        setUtilisateur(profilCache);
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
