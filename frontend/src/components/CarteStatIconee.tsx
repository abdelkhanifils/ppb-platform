import type { LucideIcon } from "lucide-react";

/** Palette de fond pour l'icône — chaque page choisit une couleur par
 * carte pour les distinguer d'un coup d'œil (voir maquettes fournies). */
export type CouleurCarteStat = "vert" | "or" | "bleu" | "violet" | "rouge" | "gris";

const FONDS_ICONE: Record<CouleurCarteStat, string> = {
  vert: "bg-emerald-100 text-emerald-600",
  or: "bg-amber-100 text-amber-600",
  bleu: "bg-blue-100 text-blue-600",
  violet: "bg-violet-100 text-violet-600",
  rouge: "bg-red-100 text-red-600",
  gris: "bg-gray-100 text-gray-500",
};

/**
 * Carte chiffrée avec icône colorée en cercle — motif répété sur Tableau de
 * bord, Commandes (résumé en bas) et Paiements (résumé en haut). `tendance`
 * est un texte libre déjà formaté par l'appelant (ex. "+12% ce mois") : ce
 * composant ne calcule aucune évolution, il l'affiche telle que fournie.
 */
export default function CarteStatIconee({
  icone: Icone,
  couleur,
  libelle,
  valeur,
  tendance,
}: {
  icone: LucideIcon;
  couleur: CouleurCarteStat;
  libelle: string;
  valeur: string | number;
  tendance?: string;
}) {
  return (
    <div className="rounded-lg border border-or/40 bg-white p-4">
      <span className={`mb-3 inline-flex size-9 items-center justify-center rounded-full ${FONDS_ICONE[couleur]}`}>
        <Icone size={18} />
      </span>
      <p className="text-sm font-semibold text-bleuCemac">{libelle}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{valeur}</p>
      {tendance && <p className="mt-1 text-xs text-emerald-600">{tendance}</p>}
    </div>
  );
}
