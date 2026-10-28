import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { I18nProvider } from "@/lib/i18n";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import BandeauMiseAJour from "@/components/BandeauMiseAJour";
import TableauDeBordLayout from "@/layouts/TableauDeBordLayout";
import Connexion from "@/pages/Connexion";
import AccesRefuse from "@/pages/AccesRefuse";
import TableauDeBord from "@/pages/TableauDeBord";
import Commandes from "@/pages/Commandes";
import Paiements from "@/pages/Paiements";
import AccueilComptabilite from "@/pages/AccueilComptabilite";
import Impression from "@/pages/Impression";
import EmissionTerrain from "@/pages/EmissionTerrain";
import ControleFrontiere from "@/pages/ControleFrontiere";
import Vaccinations from "@/pages/Vaccinations";
import Administration from "@/pages/Administration";
import Statistiques from "@/pages/Statistiques";
import RolesAcces from "@/pages/RolesAcces";
import UtilisateursEnLigne from "@/pages/UtilisateursEnLigne";
import { Role } from "@/types/roles";

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
      <AuthProvider>
        <Routes>
          <Route path="/connexion" element={<Connexion />} />
          <Route path="/acces-refuse" element={<AccesRefuse />} />

          {/* Toute personne authentifiée, quel que soit son rôle */}
          <Route element={<ProtectedRoute />}>
            <Route element={<TableauDeBordLayout />}>
              <Route path="/" element={<TableauDeBord />} />

              <Route element={<ProtectedRoute rolesAutorises={[Role.ADMIN_NATIONAL, Role.SUPER_ADMIN, Role.COMPTABILITE, Role.GESTIONNAIRE_CEBEVIRHA]} permissions={["commandes.gerer"]} />}>
                <Route path="/commandes" element={<Commandes />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.CONSULTATION, Role.COMPTABILITE, Role.GESTIONNAIRE_CEBEVIRHA, Role.SUPER_ADMIN]} permissions={["comptabilite.consulter"]} />}>
                <Route path="/etats-paiements" element={<AccueilComptabilite lectureSeule />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.COMPTABILITE, Role.GESTIONNAIRE_CEBEVIRHA]} permissions={["paiements.enregistrer", "paiements.valider"]} />}>
                <Route path="/paiements" element={<Paiements />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.GESTIONNAIRE_CEBEVIRHA]} permissions={["impression.centralisee", "impression.lot", "impression.autorisations"]} />}>
                <Route path="/impression" element={<Impression />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.AGENT_EMISSION]} permissions={["numerisations.scanner"]} />}>
                <Route path="/emission" element={<EmissionTerrain />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.AGENT_CONTROLE]} permissions={["controles.effectuer"]} />}>
                <Route path="/controle" element={<ControleFrontiere />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.VETERINAIRE]} />}>
                <Route path="/vaccinations" element={<Vaccinations />} />
              </Route>

              <Route element={<ProtectedRoute rolesAutorises={[Role.SUPER_ADMIN, Role.ADMIN_NATIONAL]} permissions={["utilisateurs.gerer", "admin.formulaires", "admin.gabarit", "branding.modifier", "referentiels.gerer", "journaux.consulter", "sauvegarde.gerer"]} />}>
                <Route path="/administration" element={<Administration />} />
              </Route>

              <Route element={<ProtectedRoute permissions={["roles.configurer"]} />}>
                <Route path="/roles" element={<RolesAcces />} />
              </Route>

              <Route element={<ProtectedRoute permissions={["presence.consulter"]} />}>
                <Route path="/en-ligne" element={<UtilisateursEnLigne />} />
              </Route>

              <Route
                element={
                  <ProtectedRoute rolesAutorises={[Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.CONSULTATION]} permissions={["statistiques.consulter"]} />
                }
              >
                <Route path="/statistiques" element={<Statistiques />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <BandeauMiseAJour />
      </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
