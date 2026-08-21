import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function AccesRefuse() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
      <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-red-50">
        <ShieldAlert size={24} className="text-red-600" />
      </span>
      <h1 className="text-xl font-semibold text-gray-900">{t("acces_refuse.titre")}</h1>
      <p className="text-sm text-gray-500">{t("acces_refuse.texte")}</p>
      <Link to="/" className="mt-4 text-sm text-cebevirha hover:underline">{t("acces_refuse.retour")}</Link>
    </div>
  );
}
