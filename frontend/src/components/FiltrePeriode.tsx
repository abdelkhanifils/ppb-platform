import { CalendarRange } from "lucide-react";
import { PRESETS_PERIODE, bornesPreset, type Periode, type PresetPeriode } from "@/lib/periode";

/** Barre de filtre de période commune à toutes les statistiques. */
export default function FiltrePeriode({
  preset, periode, onChange,
}: { preset: PresetPeriode; periode: Periode; onChange: (preset: PresetPeriode, periode: Periode) => void }) {
  const invalide = !!periode.debut && !!periode.fin && periode.debut > periode.fin;
  return (
    <div className="hors-impression flex flex-wrap items-end gap-3 rounded-lg border border-or/40 bg-white p-3">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><CalendarRange size={14} /> Période</span>
      <select
        value={preset}
        onChange={(e) => {
          const p = e.target.value as PresetPeriode;
          onChange(p, p === "perso" ? periode : bornesPreset(p));
        }}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        aria-label="Période"
      >
        {PRESETS_PERIODE.map((p) => <option key={p.cle} value={p.cle}>{p.libelle}</option>)}
      </select>
      {preset === "perso" && (
        <>
          <label className="text-xs text-gray-500">Du
            <input type="date" value={periode.debut} max={periode.fin || undefined} onChange={(e) => onChange("perso", { ...periode, debut: e.target.value })} className="ml-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-500">au
            <input type="date" value={periode.fin} min={periode.debut || undefined} onChange={(e) => onChange("perso", { ...periode, fin: e.target.value })} className="ml-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
          </label>
        </>
      )}
      {preset !== "tout" && periode.debut && periode.fin && (
        <span className="text-xs text-gray-500">{new Date(periode.debut).toLocaleDateString("fr-FR")} → {new Date(periode.fin).toLocaleDateString("fr-FR")}</span>
      )}
      {invalide && <span className="text-xs text-red-600">La date de début doit précéder la date de fin.</span>}
    </div>
  );
}
