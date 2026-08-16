import type { ItineraireVerificationApi, PasseportVerificationApi } from "@/types/controle";

const LIBELLES_ESPECE: Record<string, string> = {
  bovin: "Bovins",
  ovin: "Ovins",
  caprin: "Caprins",
  camelin: "Camelins",
  autre: "Autres",
};

/**
 * Aperçu du document — affiché après chaque scan, à côté du résultat de
 * vérification (signature/conformité). Reproduit la logique du document
 * papier : les champs remplis à la main sur le terrain (Module 4)
 * n'apparaissent ICI que s'ils ont été transmis et synchronisés
 * localement — sinon, ils s'affichent explicitement vides, jamais
 * inventés ni masqués. Un passeport encore PRECHARGE/VIERGE (jamais émis)
 * affichera donc systématiquement tout vide, à l'identique d'un document
 * papier jamais rempli.
 */
export default function ApercuDocumentPasseport({
  passeport,
  itineraire,
}: {
  passeport: PasseportVerificationApi;
  itineraire?: ItineraireVerificationApi;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Aperçu du document</p>
        <p className="font-mono text-xs text-gray-400">N° {passeport.numero}</p>
      </div>

      <Section titre="Identification et trajet">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Champ label="Propriétaire" valeur={itineraire?.eleveur?.nom_prenom} />
          <Champ label="Convoyeur" valeur={itineraire?.convoyeur?.nom_prenom} />
          <Champ label="N° CNI propriétaire" valeur={itineraire?.eleveur?.numero_cni} />
          <Champ label="N° CNI convoyeur" valeur={itineraire?.convoyeur?.numero_cni} />
          <Champ
            label="Origine"
            valeur={itineraire ? [itineraire.province_origine, itineraire.localite_origine].filter(Boolean).join(", ") : undefined}
          />
          <Champ
            label="Destination"
            valeur={itineraire ? [itineraire.province_destination, itineraire.localite_destination].filter(Boolean).join(", ") : undefined}
          />
        </div>
        {!itineraire && <NoteVide>Itinéraire pas encore synchronisé — repli sur la page papier.</NoteVide>}
      </Section>

      <Section titre="Composition du troupeau">
        {itineraire && itineraire.troupeau_especes.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 font-normal">Espèce</th>
                <th className="py-1 text-right font-normal">Mâles</th>
                <th className="py-1 text-right font-normal">Fem. jeunes</th>
                <th className="py-1 text-right font-normal">Fem. adultes</th>
                <th className="py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {itineraire.troupeau_especes.map((e, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1 font-medium text-gray-800">{LIBELLES_ESPECE[e.espece] ?? e.espece}</td>
                  <td className="py-1 text-right">{e.nombre_males}</td>
                  <td className="py-1 text-right">{e.nombre_femelles_jeunes}</td>
                  <td className="py-1 text-right">{e.nombre_femelles_adultes}</td>
                  <td className="py-1 text-right font-medium">{e.nombre_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoteVide>
            {itineraire
              ? "Composition non renseignée — page 4 pas encore transmise par l'agent d'émission."
              : "Passeport pas encore émis sur le terrain."}
          </NoteVide>
        )}
      </Section>

      {itineraire && itineraire.vaccinations.length > 0 && (
        <Section titre="Vaccinations">
          <ul className="space-y-1 text-xs text-gray-700">
            {itineraire.vaccinations.map((v, i) => (
              <li key={i}>
                {v.maladie.replace(/_/g, " ")} — {v.date_vaccination ?? "date non renseignée"}
                {v.lieu ? ` (${v.lieu})` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-gray-700">{titre}</p>
      {children}
    </div>
  );
}

function Champ({ label, valeur }: { label: string; valeur?: string }) {
  return (
    <div className="text-xs">
      <p className="text-gray-400">{label}</p>
      <p className={valeur ? "font-medium text-gray-800" : "italic text-gray-300"}>{valeur || "— non renseigné —"}</p>
    </div>
  );
}

function NoteVide({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-gray-50 px-2.5 py-2 text-xs italic text-gray-400">{children}</p>;
}
