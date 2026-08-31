import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Globe, LogOut, Menu, WifiOff, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LIBELLES_ROLE, Role } from "@/types/roles";
import { urlLogoActuel, useBranding } from "@/lib/branding";
import { useI18n, type Langue } from "@/lib/i18n";

interface LienNav {
  to: string;
  cle: string;
  rolesAutorises?: Role[];
}

// Liens affichés selon le rôle — reflète les acteurs du diagramme de cas d'utilisation.
const LIENS: LienNav[] = [
  { to: "/", cle: "nav.tableau_bord" },
  { to: "/commandes", cle: "nav.commandes", rolesAutorises: [Role.ADMIN_NATIONAL, Role.SUPER_ADMIN] },
  { to: "/paiements", cle: "nav.paiements", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL] },
  { to: "/impression", cle: "nav.impression", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL] },
  { to: "/emission", cle: "nav.emission", rolesAutorises: [Role.AGENT_EMISSION] },
  { to: "/controle", cle: "nav.controle", rolesAutorises: [Role.AGENT_CONTROLE] },
  { to: "/vaccinations", cle: "nav.vaccinations", rolesAutorises: [Role.VETERINAIRE] },
  { to: "/administration", cle: "nav.administration", rolesAutorises: [Role.SUPER_ADMIN] },
  { to: "/statistiques", cle: "nav.statistiques", rolesAutorises: [Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.CONSULTATION] },
];

export default function TableauDeBordLayout() {
  const { utilisateur, deconnecter, horsLigne } = useAuth();
  const { t } = useI18n();
  // Barre latérale : repliée par défaut (tiroir superposé) sous la largeur
  // tablette (md, 768px) — au-delà, toujours visible côte à côte.
  const [menuOuvert, setMenuOuvert] = useState(false);
  const branding = useBranding(); // re-rend dès que /branding répond, pour que urlLogoActuel() reflète un logo personnalisé
  // Même fichier que celui imprimé sur le gabarit du passeport (voir
  // backend/app/assets/logo_cebevirha.png, identique) — le texte
  // "CEBEVIRHA" et le sous-titre sont déjà intégrés à l'image elle-même,
  // aucun texte séparé à recoder à côté. Un logo personnalisé uploadé via
  // Administration > Apparence reste toujours prioritaire sur ce repli.
  const logo = urlLogoActuel() ?? "/logo-cebevirha.png";
  // Icône compacte (sceau CEMAC seul, recadré depuis logo-cebevirha.png) —
  // pour la barre latérale, trop étroite pour la bannière complète
  // ci-dessus (utilisée dans la barre du haut à la place, plus large).
  const logoIcone = urlLogoActuel() ?? "/logo-cebevirha-icone.png";
  const nomApplication = branding?.nom_application ?? "PPB — CEBEVIRHA";
  if (!utilisateur) return null;

  const liensVisibles = LIENS.filter((lien) => !lien.rolesAutorises || lien.rolesAutorises.includes(utilisateur.role));

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Fine bande dorée — seule touche de couleur signature de cette mise
          en page, écho volontairement discret de la bande jaune du sceau
          CEMAC/CEBEVIRHA (voir logo-cebevirha.png) qui figure sur chaque
          document PPB imprimé. Un seul geste de couleur marqué, tout le
          reste de l'interface reste sobre — cf. principe de retenue. */}
      <div className="h-[3px] shrink-0 bg-or" aria-hidden="true" />

      <div className="flex min-h-0 flex-1">
        {/* Fond assombri derrière le tiroir mobile — cliquer dessus referme
            le menu. N'existe qu'en dessous de md. */}
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
          <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-5 py-4">
            <div className="min-w-0">
              <img src={logoIcone} alt="" className="h-9 w-auto" />
              <p className="mt-2 truncate text-sm font-semibold leading-tight text-cebevirha">{nomApplication}</p>
            </div>
            <button
              onClick={() => setMenuOuvert(false)}
              className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 md:hidden"
              aria-label={t("layout.fermer_menu")}
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
                  `rounded-md border-l-[3px] px-3 py-2.5 text-base transition-colors ${
                    isActive
                      ? "border-cebevirha bg-cebevirha/10 font-medium text-cebevirha"
                      : "border-transparent font-medium text-bleuCemac hover:border-gray-200 hover:bg-gray-100"
                  }`
                }
              >
                {t(lien.cle)}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3 md:px-6 md:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                onClick={() => setMenuOuvert(true)}
                className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 md:hidden"
                aria-label={t("layout.ouvrir_menu")}
              >
                <Menu size={20} />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{utilisateur.nom_complet}</p>
                <p className="truncate text-xs text-gray-500">{LIBELLES_ROLE[utilisateur.role]}</p>
              </div>
            </div>

            {/* Bannière officielle (même fichier que le gabarit du passeport
                imprimé) — placée ici, dans la barre du haut, plutôt que dans
                la barre latérale : trop étroite (256px) pour l'afficher
                lisiblement à pleine largeur sans la rogner. */}
            <div className="hidden min-w-0 flex-1 justify-center px-3 sm:flex">
              <img src={logo} alt="CEBEVIRHA" className="h-auto max-h-36 w-full object-contain" />
            </div>

            <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
              {horsLigne && (
                <span
                  className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
                  title="Connexion réseau indisponible — profil affiché depuis la dernière session enregistrée localement."
                >
                  <WifiOff size={12} /> <span className="hidden sm:inline">Hors-ligne</span>
                </span>
              )}
              <SelecteurLangue />
              <button
                onClick={deconnecter}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 md:px-3"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">{t("layout.deconnexion")}</span>
              </button>
            </div>
          </header>

          <main className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * Sélecteur FR/EN — même principe que le panneau réglages de l'application
 * mobile terrain (mobile/src/pages/Index.tsx::PanneauReglages) : deux
 * options directes plutôt qu'un menu déroulant, la langue de l'interface
 * n'étant qu'un choix binaire ici comme là-bas.
 */
function SelecteurLangue() {
  const { langue, changerLangue, t } = useI18n();
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOuvert((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
        aria-label={t("langue.libelle")}
      >
        <Globe size={16} />
        <span className="hidden sm:inline">{langue.toUpperCase()}</span>
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} aria-hidden="true" />
          <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border border-gray-200 bg-white p-1 shadow-md">
            {(["fr", "en"] as Langue[]).map((code) => (
              <button
                key={code}
                onClick={() => {
                  changerLangue(code);
                  setOuvert(false);
                }}
                className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
                  langue === code ? "bg-cebevirha/10 font-medium text-cebevirha" : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {code === "fr" ? t("langue.francais") : t("langue.anglais")}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
