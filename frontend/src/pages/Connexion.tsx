import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AxiosError } from "axios";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
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

  /** Page d'atterrissage la plus utile selon le rôle — un agent de contrôle
   * ou d'émission n'a normalement affaire qu'à un seul écran ; l'y amener
   * directement évite une navigation manuelle systématique après chaque
   * connexion (et, question apparence, applique immédiatement la zone de
   * personnalisation "controle" au lieu de rester un instant sur "global" —
   * voir src/lib/branding.ts). Les autres rôles gardent le tableau de bord
   * général, toujours pertinent pour eux. */
  const pageApresConnexion = (role: Role): string => {
    if (role === Role.AGENT_CONTROLE) return "/controle";
    if (role === Role.AGENT_EMISSION) return "/emission";
    if (role === Role.VETERINAIRE) return "/vaccinations";
    if (role === Role.COMPTABILITE) return "/commandes";
    return "/";
  };

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      const utilisateurConnecte = await connecter(email, motDePasse);
      navigate(utilisateurConnecte ? pageApresConnexion(utilisateurConnecte.role) : "/", { replace: true });
    } catch (err) {
      // Quatre cas distincts, jamais confondus dans le message affiché :
      // 1. Mot de passe vraiment incorrect (vérifiable même hors-ligne, si
      //    déjà connecté avant sur cet appareil) — voir AuthContext::connecter.
      // 2. Coupure réseau lors d'une toute première connexion sur cet
      //    appareil (rien à vérifier localement) — nécessite Internet.
      // 3. Identifiants incorrects confirmés par le serveur (401), en ligne.
      // 4. Erreur SERVEUR (500 ou autre) — jamais confondue avec un vrai
      //    refus d'identifiants : un problème de configuration ou de code
      //    côté serveur affiché comme "mot de passe incorrect" empêcherait
      //    de jamais trouver la vraie cause (confirmé en test réel).
      if (err instanceof Error && err.message === "PPB_MOT_DE_PASSE_INCORRECT_LOCAL") {
        setErreur(t("connexion.erreur"));
      } else if (!(err as AxiosError).response) {
        setErreur(t("connexion.hors_ligne_premiere_fois"));
      } else if ((err as AxiosError).response?.status === 401) {
        setErreur(t("connexion.erreur"));
      } else {
        const statut = (err as AxiosError).response?.status;
        const detail = ((err as AxiosError).response?.data as { detail?: string } | undefined)?.detail;
        setErreur(`Erreur serveur (${statut ?? "?"})${detail ? ` — ${detail}` : ""}`);
      }
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
