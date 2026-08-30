import { Syringe } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function Vaccinations() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cebevirha/10">
          <Syringe size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">{t("nav.vaccinations")}</h1>
          <p className="text-sm text-gray-500">{t("vaccinations.description")}</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
        {t("vaccinations.a_implementer")}
      </div>
    </div>
  );
}
