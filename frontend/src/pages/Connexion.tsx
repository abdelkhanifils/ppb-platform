import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function Connexion() {
  const { connecter } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      await connecter(email, motDePasse);
      navigate("/", { replace: true });
    } catch {
      setErreur("Email ou mot de passe incorrect.");
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-cebevirha">Passeport Pour Bétail</h1>
        <p className="mb-6 text-sm text-gray-500">CEBEVIRHA — Plateforme numérique du PPB</p>

        <form onSubmit={soumettre} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Mot de passe</label>
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
            {envoiEnCours ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
