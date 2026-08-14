import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import "leaflet/dist/leaflet.css";
import { apiClient } from "@/api/client";
import type { ClusterMouvements, StatistiquesParPoste, TableauBordRegional } from "@/types/statistiques";
import { LIBELLES_PHASE } from "@/types/statistiques";

/**
 * Tableau de bord régional (Module transversal Statistiques) — trois axes :
 * par pays, par phase (entonnoir du pipeline M3->M5) et par poste, plus une
 * carte des mouvements de contrôle (clusters PostGIS en production — voir
 * backend/app/services/geospatial.py, repli portable en développement).
 */
export default function Statistiques() {
  const [tableauBord, setTableauBord] = useState<TableauBordRegional | null>(null);
  const [postes, setPostes] = useState<StatistiquesParPoste[]>([]);
  const [clusters, setClusters] = useState<ClusterMouvements[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get<TableauBordRegional>("/statistiques/tableau-bord"),
      apiClient.get<StatistiquesParPoste[]>("/statistiques/par-poste"),
      apiClient.get<{ clusters: ClusterMouvements[] }>("/statistiques/carte-mouvements"),
    ])
      .then(([bord, postesReponse, clustersReponse]) => {
        setTableauBord(bord.data);
        setPostes(postesReponse.data);
        setClusters(clustersReponse.data.clusters);
      })
      .catch(() => setErreur("Impossible de charger le tableau de bord."))
      .finally(() => setChargement(false));
  }, []);

  if (chargement) return <p className="text-sm text-gray-500">Chargement du tableau de bord…</p>;
  if (erreur || !tableauBord) return <p className="text-sm text-red-600">{erreur ?? "Données indisponibles."}</p>;

  const donneesEntonnoir = tableauBord.entonnoir_global.map((p) => ({
    phase: LIBELLES_PHASE[p.statut] ?? p.statut,
    nombre: p.nombre,
  }));

  const donneesParPays = tableauBord.par_pays.map((p) => ({
    pays: p.code_iso,
    commandes: p.nb_commandes,
    emis: p.passeports_par_statut.emis ?? 0,
    controle: p.passeports_par_statut.controle ?? 0,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tableau de bord régional</h1>
        <p className="text-sm text-gray-500">
          {tableauBord.totaux.nb_pays} pays · {tableauBord.totaux.nb_commandes_total} commandes ·{" "}
          {tableauBord.totaux.montant_encaisse_total_xaf.toLocaleString("fr-FR")} XAF encaissés
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Entonnoir global — par phase du pipeline</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={donneesEntonnoir}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="phase" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="nombre" fill="#0f5132" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Par pays — commandes et passeports émis/contrôlés</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={donneesParPays}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="pays" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="commandes" name="Commandes" fill="#146c43" radius={[4, 4, 0, 0]} />
            <Bar dataKey="emis" name="Émis" fill="#5c9e78" radius={[4, 4, 0, 0]} />
            <Bar dataKey="controle" name="Contrôlés" fill="#9dc6ac" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Par poste de contrôle</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="py-2 pr-4">Poste</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4 text-green-700">Validés</th>
                <th className="py-2 pr-4 text-red-700">Refusés</th>
                <th className="py-2 pr-4 text-amber-700">À vérifier</th>
              </tr>
            </thead>
            <tbody>
              {postes.map((poste) => (
                <tr key={poste.poste_id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">{poste.nom}</td>
                  <td className="py-2 pr-4 font-medium">{poste.total_controles}</td>
                  <td className="py-2 pr-4">{poste.controles_par_resultat.valide ?? 0}</td>
                  <td className="py-2 pr-4">{poste.controles_par_resultat.refuse ?? 0}</td>
                  <td className="py-2 pr-4">{poste.controles_par_resultat.a_verifier ?? 0}</td>
                </tr>
              ))}
              {postes.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400">
                    Aucun poste référencé pour l'instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Carte des mouvements — clusters de contrôle</h2>
        <p className="mb-3 text-xs text-gray-500">
          Regroupement géospatial (PostGIS en production) des contrôles enregistrés. Taille du cercle proportionnelle
          au volume ; couleur selon la proportion de résultats validés.
        </p>
        {clusters.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            Aucun contrôle géolocalisé pour l'instant.
          </p>
        ) : (
          <div className="h-96 overflow-hidden rounded-lg">
            <MapContainer center={[7.5, 15]} zoom={5} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {clusters.map((cluster) => (
                <CircleMarker
                  key={cluster.cluster_id}
                  center={[cluster.latitude_centre, cluster.longitude_centre]}
                  radius={Math.min(8 + cluster.nombre * 2, 30)}
                  pathOptions={{ color: couleurCluster(cluster), fillColor: couleurCluster(cluster), fillOpacity: 0.5 }}
                >
                  <Popup>
                    <p className="font-medium">{cluster.nombre} contrôle(s)</p>
                    <p>Validés : {cluster.valides}</p>
                    <p>Refusés : {cluster.refuses}</p>
                    <p>À vérifier : {cluster.a_verifier}</p>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        )}
      </section>
    </div>
  );
}

function couleurCluster(cluster: ClusterMouvements): string {
  const proportionValide = cluster.nombre > 0 ? cluster.valides / cluster.nombre : 0;
  if (proportionValide >= 0.8) return "#146c43";
  if (proportionValide >= 0.5) return "#d97706";
  return "#dc2626";
}
