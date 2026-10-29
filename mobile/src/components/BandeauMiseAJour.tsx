import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

/** Bandeau vert en bas de l'écran quand une nouvelle version est prête (même principe que la plateforme
 * web et le contrôle) : l'agent choisit le moment, aucune mise à jour forcée pendant une saisie. */
export default function BandeauMiseAJour() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const surEvenement = () => setVisible(true);
    window.addEventListener('ppb:maj-disponible', surEvenement);
    return () => window.removeEventListener('ppb:maj-disponible', surEvenement);
  }, []);

  if (!visible) return null;

  const appliquer = () => {
    const fn = (window as unknown as { __ppbAppliquerMiseAJour?: () => Promise<void> }).__ppbAppliquerMiseAJour;
    void fn?.();
  };

  return (
    <div className="zone-sure-bas fixed inset-x-0 bottom-0 z-[60] flex items-center justify-between gap-3 bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg">
      <span>{t('maj.disponible')}</span>
      <button
        type="button"
        onClick={appliquer}
        className="cible-tactile rounded-md bg-white/20 px-3 py-1.5 font-medium hover:bg-white/30"
      >
        {t('maj.bouton')}
      </button>
    </div>
  );
}
