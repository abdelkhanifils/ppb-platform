import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { urlLogoActuel, useBranding } from "@/lib/branding";
import { useI18n } from "@/lib/i18n";

export default function Connexion() {
  const { connecter } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const branding = useBranding();
  const logo = urlLogoActuel();
  const nomApplication = branding?.nom_application ?? "Passeport Pour Bétail";

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      await connecter(email, motDePasse);
      navigate("/", { replace: true });
    } catch {
      setErreur(t("connexion.erreur"));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        {logo && <img src={logo} alt={nomApplication} className="mb-3 h-12 w-auto" />}
        <h1 className="mb-1 text-lg font-semibold text-cebevirha">{nomApplication}</h1>
        <p className="mb-6 text-sm text-gray-500">{t("connexion.organisme")}</p>

        <form onSubmit={soumettre} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t("connexion.email")}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t("connexion.mot_de_passe")}</label>
            <input
              type="password"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
            />
          </div>

          {erreur && <p className="text-sm text-red-600">{erreur}</p>}

          <button
            type="submit"
            disabled={envoiEnCours}
            className="w-full rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
          >
            {envoiEnCours ? t("connexion.en_cours") : t("connexion.se_connecter")}
          </button>
        </form>
      </div>
    </div>
  );
}
