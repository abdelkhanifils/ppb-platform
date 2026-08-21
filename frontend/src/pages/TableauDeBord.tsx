import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, CreditCard, Printer, Settings, TrendingUp } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { TableauBordRegional } from "@/types/statistiques";
import type { ControleHistoriqueApi } from "@/types/controle";

/** Écran d'accueil ("/") — son contenu s'adapte au rôle connecté : les
 * agents terrain sont dirigés vers leur outil dédié, les profils de
 * pilotage voient un résumé chiffré et des raccourcis. */
export default function TableauDeBord() {
  const { utilisateur } = useAuth();
  if (!utilisateur) return null;

  if (utilisateur.role === Role.AGENT_EMISSION) return <AccueilAgentTerrain lien="/emission" titre="Émission terrain" description="Vérifiez et validez les PPB page par page, avec ou sans connexion." />;
  if (utilisateur.role === Role.AGENT_CONTROLE) return <AccueilAgentTerrain lien="/controle" titre="Contrôle frontière" description="Scannez un PPB pour vérifier son authenticité et sa conformité au trajet déclaré." />;
  if (utilisateur.role === Role.VETERINAIRE) return <AccueilVeterinaire />;

  return <AccueilPilotage />;
}

function AccueilAgentTerrain({ lien, titre, description }: { lien: string; titre: string; description: string }) {
  return (
    <div className="mx-auto max-w-md space-y-4 pt-10 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Bienvenue</h1>
      <p className="text-sm text-gray-500">{description}</p>
      <Link to={lien} className="inline-block rounded-md bg-cebevirha px-6 py-3 text-sm font-medium text-white hover:bg-cebevirha-light">
        Ouvrir {titre}
      </Link>
    </div>
  );
}

function AccueilVeterinaire() {
  return (
    <div className="mx-auto max-w-md space-y-4 pt-10 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Bienvenue</h1>
      <p className="text-sm text-gray-500">
        La validation des informations sanitaires et des certificats de vaccination se fait actuellement via l'agent
        d'émission sur le terrain (Module 4, page 4).
      </p>
    </div>
  );
}

function AccueilPilotage() {
  const [donnees, setDonnees] = useState<TableauBordRegional | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    apiClient
      .get<TableauBordRegional>("/statistiques/tableau-bord")
      .then(({ data }) => setDonnees(data))
      .finally(() => setChargement(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tableau de bord</h1>
        <p className="text-sm text-gray-500">Vue d'ensemble de la plateforme PPB.</p>
      </div>

      {chargement && <p className="text-sm text-gray-500">Chargement…</p>}

      {!chargement && donnees && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CarteChiffre libelle="Pays actifs" valeur={donnees.totaux.nb_pays} />
          <CarteChiffre libelle="Commandes" valeur={donnees.totaux.nb_commandes_total} />
          <CarteChiffre libelle="Montant encaissé (XAF)" valeur={donnees.totaux.montant_encaisse_total_xaf.toLocaleString("fr-FR")} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteRaccourci lien="/commandes" icone={ClipboardList} titre="Commandes" description="Passer et suivre les commandes de PPB." />
        <CarteRaccourci lien="/paiements" icone={CreditCard} titre="Paiements" description="Enregistrer et valider les paiements." />
        <CarteRaccourci lien="/impression" icone={Printer} titre="Impression" description="Confirmer l'impression des commandes payées." />
        <CarteRaccourci lien="/statistiques" icone={TrendingUp} titre="Statistiques" description="Tableau de bord régional détaillé." />
        <RaccourciAdministration />
      </div>

      <ControlesRecents />
    </div>
  );
}

function ControlesRecents() {
  const [controles, setControles] = useState<ControleHistoriqueApi[] | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    apiClient
      .get<ControleHistoriqueApi[]>("/controles", { params: { limite: 10 } })
      .then(({ data }) => setControles(data))
      .catch(() => setErreur(true));
  }, []);

  if (erreur) return null; // section discrète — pas d'erreur bloquante sur l'accueil

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">Contrôles récents à la frontière</p>
        <p className="text-xs text-gray-500">Les 10 derniers passeports contrôlés, tous postes confondus.</p>
      </div>
      {controles === null ? (
        <p className="p-4 text-sm text-gray-500">Chargement…</p>
      ) : controles.length === 0 ? (
        <p className="p-4 text-sm text-gray-400">Aucun contrôle enregistré pour l'instant.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-cebevirha/5 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2.5">Passeport</th>
              <th className="px-4 py-2.5">Poste</th>
              <th className="px-4 py-2.5">Résultat</th>
              <th className="px-4 py-2.5">Agent</th>
              <th className="px-4 py-2.5">Date</th>
            </tr>
          </thead>
          <tbody>
            {controles.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-2.5 font-mono text-xs">{c.numero}</td>
                <td className="px-4 py-2.5">{c.poste_id}</td>
                <td className="px-4 py-2.5">
                  <BadgeResultat resultat={c.resultat} />
                </td>
                <td className="px-4 py-2.5">{c.agent_nom}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{new Date(c.date).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BadgeResultat({ resultat }: { resultat: ControleHistoriqueApi["resultat"] }) {
  const styles: Record<ControleHistoriqueApi["resultat"], string> = {
    valide: "bg-green-100 text-green-700",
    refuse: "bg-red-100 text-red-700",
    a_verifier: "bg-amber-100 text-amber-700",
  };
  const libelles: Record<ControleHistoriqueApi["resultat"], string> = {
    valide: "Validé",
    refuse: "Refusé",
    a_verifier: "À vérifier",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[resultat]}`}>{libelles[resultat]}</span>;
}

function RaccourciAdministration() {
  const { utilisateur } = useAuth();
  if (utilisateur?.role !== Role.SUPER_ADMIN) return null;
  return <CarteRaccourci lien="/administration" icone={Settings} titre="Administration" description="Formulaires, paramètres, gabarit du PPB." />;
}

function CarteChiffre({ libelle, valeur }: { libelle: string; valeur: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 border-t-2 border-t-cebevirha bg-white p-4">
      <p className="text-xs text-gray-500">{libelle}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{valeur}</p>
    </div>
  );
}

function CarteRaccourci({
  lien,
  icone: Icone,
  titre,
  description,
}: {
  lien: string;
  icone: typeof ClipboardList;
  titre: string;
  description: string;
}) {
  return (
    <Link to={lien} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-cebevirha hover:shadow-sm">
      <span className="mb-2 inline-flex size-9 items-center justify-center rounded-md bg-cebevirha/10">
        <Icone size={18} className="text-cebevirha" />
      </span>
      <p className="text-sm font-semibold text-gray-800">{titre}</p>
      <p className="mt-0.5 text-xs text-gray-500">{description}</p>
    </Link>
  );
}
