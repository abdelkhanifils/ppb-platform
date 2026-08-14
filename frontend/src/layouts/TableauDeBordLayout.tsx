import { NavLink, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LIBELLES_ROLE, Role } from "@/types/roles";

interface LienNav {
  to: string;
  label: string;
  rolesAutorises?: Role[];
}

// Liens affichés selon le rôle — reflète les acteurs du diagramme de cas d'utilisation.
const LIENS: LienNav[] = [
  { to: "/", label: "Tableau de bord" },
  { to: "/commandes", label: "Commandes", rolesAutorises: [Role.ADMIN_NATIONAL, Role.SUPER_ADMIN] },
  { to: "/paiements", label: "Paiements", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL] },
  { to: "/emission", label: "Émission terrain", rolesAutorises: [Role.AGENT_EMISSION] },
  { to: "/controle", label: "Contrôle frontière", rolesAutorises: [Role.AGENT_CONTROLE] },
  { to: "/vaccinations", label: "Vaccinations", rolesAutorises: [Role.VETERINAIRE] },
  { to: "/administration", label: "Administration", rolesAutorises: [Role.SUPER_ADMIN] },
  { to: "/statistiques", label: "Statistiques", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.CONSULTATION] },
];

export default function TableauDeBordLayout() {
  const { utilisateur, deconnecter } = useAuth();
  if (!utilisateur) return null;

  const liensVisibles = LIENS.filter((lien) => !lien.rolesAutorises || lien.rolesAutorises.includes(utilisateur.role));

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-5">
          <p className="font-semibold text-cebevirha">PPB — CEBEVIRHA</p>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {liensVisibles.map((lien) => (
            <NavLink
              key={lien.to}
              to={lien.to}
              end={lien.to === "/"}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${
                  isActive ? "bg-cebevirha/10 font-medium text-cebevirha" : "text-gray-600 hover:bg-gray-100"
                }`
              }
            >
              {lien.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div>
            <p className="text-sm font-medium text-gray-900">{utilisateur.nom_complet}</p>
            <p className="text-xs text-gray-500">{LIBELLES_ROLE[utilisateur.role]}</p>
          </div>
          <button
            onClick={deconnecter}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={16} /> Déconnexion
          </button>
        </header>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
