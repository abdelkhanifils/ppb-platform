import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

export default function AccesRefuse() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
      <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-red-50">
        <ShieldAlert size={24} className="text-red-600" />
      </span>
      <h1 className="text-xl font-semibold text-gray-900">Accès refusé</h1>
      <p className="text-sm text-gray-500">Votre rôle ne permet pas d'accéder à cette page.</p>
      <Link to="/" className="mt-4 text-sm text-cebevirha hover:underline">Retour au tableau de bord</Link>
    </div>
  );
}
