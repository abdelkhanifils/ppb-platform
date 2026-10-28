import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { Role } from "@/types/roles";

interface ProtectedRouteProps {
  /** Rôles autorisés. Si omis, toute personne authentifiée peut accéder à la route. */
  rolesAutorises?: Role[];
  /** Fonctionnalités (matrice « Rôles et accès ») : l'accès est aussi ouvert à qui en possède une. */
  permissions?: string[];
}

/**
 * Garde de route RBAC — miroir côté client de `require_roles(...)` (backend).
 * Rappel : cette garde est un confort d'UX, jamais la source de vérité de
 * sécurité — chaque endpoint applique sa propre garde côté serveur.
 */
export function ProtectedRoute({ rolesAutorises, permissions }: ProtectedRouteProps) {
  const { utilisateur, chargement, aPermission } = useAuth();

  if (chargement) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Chargement…</div>;
  }

  if (!utilisateur) {
    return <Navigate to="/connexion" replace />;
  }

  const parRole = !!rolesAutorises && rolesAutorises.includes(utilisateur.role);
  const parPermission = !!permissions && aPermission(...permissions);
  if ((rolesAutorises || permissions) && !parRole && !parPermission) {
    return <Navigate to="/acces-refuse" replace />;
  }

  return <Outlet />;
}
