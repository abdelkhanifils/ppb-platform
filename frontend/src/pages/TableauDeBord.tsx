import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, CreditCard, Settings, TrendingUp } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { TableauBordRegional } from "@/types/statistiques";

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
        <CarteRaccourci lien="/statistiques" icone={TrendingUp} titre="Statistiques" description="Tableau de bord régional détaillé." />
        <RaccourciAdministration />
      </div>
    </div>
  );
}

function RaccourciAdministration() {
  const { utilisateur } = useAuth();
  if (utilisateur?.role !== Role.SUPER_ADMIN) return null;
  return <CarteRaccourci lien="/administration" icone={Settings} titre="Administration" description="Formulaires, paramètres, gabarit du PPB." />;
}

function CarteChiffre({ libelle, valeur }: { libelle: string; valeur: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
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
      <Icone size={20} className="mb-2 text-cebevirha" />
      <p className="text-sm font-semibold text-gray-800">{titre}</p>
      <p className="mt-0.5 text-xs text-gray-500">{description}</p>
    </Link>
  );
}
