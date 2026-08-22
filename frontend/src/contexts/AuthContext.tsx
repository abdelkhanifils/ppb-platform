import React, { createContext, useContext, useEffect, useState } from "react";
import { AxiosError } from "axios";
import { apiClient, tokenStorage } from "@/api/client";
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

function effacerUtilisateurCache(): void {
  localStorage.removeItem(CLE_UTILISATEUR_CACHE);
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
        effacerUtilisateurCache();
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
    const { data } = await apiClient.post("/auth/login", { email, password: motDePasse });
    tokenStorage.set(data.access_token, data.refresh_token);
    await chargerUtilisateurCourant();
  };

  const deconnecter = () => {
    tokenStorage.clear();
    effacerUtilisateurCache();
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
