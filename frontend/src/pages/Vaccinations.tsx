import { Syringe } from "lucide-react";

export default function Vaccinations() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cebevirha/10">
          <Syringe size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vaccinations</h1>
          <p className="text-sm text-gray-500">Validation des informations sanitaires et certificats de vaccination.</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
        Écran à implémenter — structure de route déjà branchée et protégée par rôle.
      </div>
    </div>
  );
}
