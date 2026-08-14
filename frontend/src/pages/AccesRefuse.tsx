import { Link } from "react-router-dom";

export default function AccesRefuse() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Accès refusé</h1>
      <p className="text-sm text-gray-500">Votre rôle ne permet pas d'accéder à cette page.</p>
      <Link to="/" className="mt-4 text-sm text-cebevirha hover:underline">Retour au tableau de bord</Link>
    </div>
  );
}
