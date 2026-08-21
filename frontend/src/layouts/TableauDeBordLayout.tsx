import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
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
  { to: "/impression", label: "Impression", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL] },
  { to: "/emission", label: "Émission terrain", rolesAutorises: [Role.AGENT_EMISSION] },
  { to: "/controle", label: "Contrôle frontière", rolesAutorises: [Role.AGENT_CONTROLE] },
  { to: "/vaccinations", label: "Vaccinations", rolesAutorises: [Role.VETERINAIRE] },
  { to: "/administration", label: "Administration", rolesAutorises: [Role.SUPER_ADMIN] },
  { to: "/statistiques", label: "Statistiques", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.CONSULTATION] },
];

export default function TableauDeBordLayout() {
  const { utilisateur, deconnecter } = useAuth();
  // Barre latérale : repliée par défaut (tiroir superposé) sous la largeur
  // tablette (md, 768px) — au-delà, toujours visible côte à côte, comme
  // avant ce changement. En dessous de md, un agent sur téléphone (voir
  // Contrôle frontière, utilisé sur le terrain) avait sinon la barre et le
  // contenu affichés côte à côte en largeur fixe, poussant le contenu hors
  // de l'écran (aucun `md:` nulle part dans la version précédente).
  const [menuOuvert, setMenuOuvert] = useState(false);
  if (!utilisateur) return null;

  const liensVisibles = LIENS.filter((lien) => !lien.rolesAutorises || lien.rolesAutorises.includes(utilisateur.role));

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Fond assombri derrière le tiroir mobile — cliquer dessus referme le
          menu. N'existe qu'en dessous de md ; au-delà la barre est statique
          et ce fond n'a pas lieu d'être (voir classes md:hidden). */}
      {menuOuvert && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setMenuOuvert(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-gray-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          menuOuvert ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5">
          <p className="font-semibold text-cebevirha">PPB — CEBEVIRHA</p>
          <button
            onClick={() => setMenuOuvert(false)}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 md:hidden"
            aria-label="Fermer le menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {liensVisibles.map((lien) => (
            <NavLink
              key={lien.to}
              to={lien.to}
              end={lien.to === "/"}
              onClick={() => setMenuOuvert(false)}
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3 md:px-6 md:py-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMenuOuvert(true)}
              className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 md:hidden"
              aria-label="Ouvrir le menu"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{utilisateur.nom_complet}</p>
              <p className="truncate text-xs text-gray-500">{LIBELLES_ROLE[utilisateur.role]}</p>
            </div>
          </div>
          <button
            onClick={deconnecter}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 md:px-3"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
