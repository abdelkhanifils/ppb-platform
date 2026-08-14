import React, { createContext, useContext, useEffect, useState } from "react";
import { apiClient, tokenStorage } from "@/api/client";
import type { Utilisateur } from "@/types/roles";

interface AuthContextValue {
  utilisateur: Utilisateur | null;
  chargement: boolean;
  connecter: (email: string, motDePasse: string) => Promise<void>;
  deconnecter: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);

  const chargerUtilisateurCourant = async () => {
    try {
      const { data } = await apiClient.get<Utilisateur>("/auth/moi");
      setUtilisateur(data);
    } catch {
      tokenStorage.clear();
      setUtilisateur(null);
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
    setUtilisateur(null);
  };

  return (
    <AuthContext.Provider value={{ utilisateur, chargement, connecter, deconnecter }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'un <AuthProvider>.");
  return ctx;
}
