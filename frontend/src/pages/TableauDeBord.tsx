import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, ClipboardList, CreditCard, Printer, Settings, TrendingUp, MapPin, Wallet } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { TableauBordRegional } from "@/types/statistiques";
import type { ControleHistoriqueApi } from "@/types/controle";
import type { Commande } from "@/types/commande";
import type { Paiement } from "@/types/paiement";
import CarteStatIconee from "@/components/CarteStatIconee";

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
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.get<TableauBordRegional>("/statistiques/tableau-bord").then(({ data }) => setDonnees(data)),
      apiClient.get<Commande[]>("/commandes").then(({ data }) => setCommandes(data)),
      apiClient.get<Paiement[]>("/paiements").then(({ data }) => setPaiements(data)),
    ]).finally(() => setChargement(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
          <LayoutGrid size={18} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tableau de bord</h1>
          <p className="text-sm text-gray-500">Vue d'ensemble de la plateforme PPB.</p>
        </div>
      </div>

      {chargement && <p className="text-sm text-gray-500">Chargement…</p>}

      {!chargement && donnees && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CarteStatIconee icone={MapPin} couleur="vert" libelle="Pays actifs" valeur={donnees.totaux.nb_pays} />
          <CarteStatIconee icone={ClipboardList} couleur="or" libelle="Commandes" valeur={donnees.totaux.nb_commandes_total} />
          <CarteStatIconee
            icone={Wallet}
            couleur="bleu"
            libelle="Montant encaissé (XAF)"
            valeur={donnees.totaux.montant_encaisse_total_xaf.toLocaleString("fr-FR")}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteRaccourci lien="/commandes" icone={ClipboardList} titre="Commandes" description="Passer et suivre les commandes de PPB." />
        <CarteRaccourci lien="/paiements" icone={CreditCard} titre="Paiements" description="Enregistrer et valider les paiements." />
        <CarteRaccourci lien="/impression" icone={Printer} titre="Impression" description="Confirmer l'impression des commandes payées." />
        <CarteRaccourci lien="/statistiques" icone={TrendingUp} titre="Statistiques" description="Tableau de bord régional détaillé." />
        <RaccourciAdministration />
      </div>

      {!chargement && <ApercuCommandes commandes={commandes} paiements={paiements} />}

      <ControlesRecents />
    </div>
  );
}

/** Regroupe commandes/paiements par jour, sur les 30 derniers jours — un
 * vrai historique calculé depuis les données déjà chargées, pas une courbe
 * illustrative : le serveur n'expose pas encore de série temporelle dédiée
 * (voir /statistiques/tableau-bord, purement agrégé), donc l'agrégation se
 * fait ici, côté client, à partir de `cree_le` sur chaque enregistrement. */
function ApercuCommandes({ commandes, paiements }: { commandes: Commande[]; paiements: Paiement[] }) {
  const donneesGraphique = useMemo(() => {
    const NB_JOURS = 30;
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);

    const jours: { date: string; cle: string; Commandes: number; Paiements: number }[] = [];
    for (let i = NB_JOURS - 1; i >= 0; i -= 1) {
      const jour = new Date(aujourdhui);
      jour.setDate(jour.getDate() - i);
      jours.push({
        date: jour.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        cle: jour.toISOString().slice(0, 10),
        Commandes: 0,
        Paiements: 0,
      });
    }
    const index = new Map(jours.map((j) => [j.cle, j]));

    for (const c of commandes) {
      const cle = c.cree_le?.slice(0, 10);
      const jour = cle ? index.get(cle) : undefined;
      if (jour) jour.Commandes += 1;
    }
    for (const p of paiements) {
      const cle = p.cree_le?.slice(0, 10);
      const jour = cle ? index.get(cle) : undefined;
      if (jour) jour.Paiements += 1;
    }
    return jours;
  }, [commandes, paiements]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">Aperçu des commandes</p>
        <span className="text-xs text-gray-400">30 derniers jours</span>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={donneesGraphique} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} interval={4} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Commandes" stroke="#0f7a3d" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Paiements" stroke="#eab308" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
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
