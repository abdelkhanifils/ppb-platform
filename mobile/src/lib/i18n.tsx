/**
 * Internationalisation FR/EN/ES/AR et réglages persistants.
 *
 * Les libellés de l'INTERFACE sont dans ces 4 langues. En revanche, les
 * libellés IMPRIMÉS du passeport papier utilisés comme ancres par l'OCR
 * (« Nom et prénom », « N° CNI », « Bovins », ...) restent toujours en
 * français dans `lib/ocr.ts` : ils décrivent le gabarit physique, pas
 * l'interface.
 *
 * L'arabe s'affiche de droite à gauche (voir I18nProvider, qui bascule
 * `document.documentElement.dir`) — la mise en page suit via
 * styles/rtl.css, même principe que le Web Admin.
 *
 * Les réglages (langue, URL de l'API) vivent dans `localStorage` : lecture
 * synchrone au démarrage, indispensable pour rendre le premier écran sans
 * attendre une transaction IndexedDB, et disponible hors connexion.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Langue = 'fr' | 'en' | 'es' | 'ar';

/** Chaque langue dans SA PROPRE langue (jamais traduite dans la langue
 * actuellement sélectionnée) — convention habituelle des sélecteurs de
 * langue, voir pages/Index.tsx::PanneauReglages. */
export const LIBELLES_LANGUE_COURTS: Record<Langue, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  ar: 'العربية',
};

/** Code de locale Intl pour le formatage des dates (toLocaleString) — voir
 * pages/Index.tsx et pages/Consultation.tsx::formaterDate. */
export const LOCALES_DATE: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', ar: 'ar' };

const CLE_LANGUE = 'ppb.langue';

/**
 * Clé versionnée volontairement.
 *
 * Une valeur enregistrée lors d'une session précédente (notamment l'URL vide
 * qui visait le proxy de développement) survivrait à une mise à jour de
 * l'application et enverrait les requêtes vers le serveur de fichiers de
 * l'aperçu, lequel répond « 405 Method Not Allowed » à un POST. Changer la clé
 * neutralise ces valeurs périmées sans rien demander à l'agent.
 */
const CLE_API = 'ppb.api_base_url.v2';

/**
 * Plateforme centrale par défaut (déploiement Railway de l'utilisateur).
 *
 * Pré-remplir cette valeur évite à chaque agent de terrain de saisir une URL
 * longue sur un clavier de téléphone — une source d'erreur qui bloquerait la
 * toute première connexion, celle qui exige justement du réseau. L'URL reste
 * modifiable dans les réglages pour un environnement de test ou de recette.
 */
export const API_PAR_DEFAUT = 'https://fearless-insight-production-1910.up.railway.app';

type Entree = { fr: string; en: string; es: string; ar: string };

const DICO: Record<string, Entree> = {
  'app.nom': { fr: 'PPB Émission', en: 'PPB Issuance', es: 'Emisión PPB', ar: 'إصدار جواز سفر الماشية' },
  'app.sous_titre': { fr: 'Passeport pour Bétail — émission terrain', en: 'Livestock Passport — field issuance', es: 'Pasaporte para el Ganado — emisión de campo', ar: 'جواز سفر الماشية — الإصدار الميداني' },
  'app.organisme': { fr: 'CEBEVIRHA — CEMAC', en: 'CEBEVIRHA — CEMAC', es: 'CEBEVIRHA — CEMAC', ar: 'CEBEVIRHA — الإيسيمو' },

  'reseau.en_ligne': { fr: 'En ligne', en: 'Online', es: 'En línea', ar: 'متصل' },
  'reseau.hors_ligne': { fr: 'Hors connexion', en: 'Offline', es: 'Sin conexión', ar: 'غير متصل' },
  'reseau.mode_terrain': { fr: 'Mode terrain : tout fonctionne sans réseau.', en: 'Field mode: everything works without a network.', es: 'Modo campo: todo funciona sin red.', ar: 'وضع الميدان: كل شيء يعمل دون شبكة.' },

  'action.continuer': { fr: 'Continuer', en: 'Continue', es: 'Continuar', ar: 'متابعة' },
  'action.retour': { fr: 'Retour', en: 'Back', es: 'Volver', ar: 'رجوع' },
  'action.annuler': { fr: 'Annuler', en: 'Cancel', es: 'Cancelar', ar: 'إلغاء' },
  'action.fermer': { fr: 'Fermer', en: 'Close', es: 'Cerrar', ar: 'إغلاق' },
  'action.enregistrer': { fr: 'Enregistrer', en: 'Save', es: 'Guardar', ar: 'حفظ' },
  'action.reessayer': { fr: 'Réessayer', en: 'Try again', es: 'Reintentar', ar: 'إعادة المحاولة' },
  'action.scanner': { fr: 'Scanner', en: 'Scan', es: 'Escanear', ar: 'مسح' },
  'action.rescanner': { fr: 'Scanner à nouveau', en: 'Scan again', es: 'Escanear de nuevo', ar: 'إعادة المسح' },
  'action.saisie_manuelle': { fr: 'Saisir à la main', en: 'Enter manually', es: 'Ingresar manualmente', ar: 'إدخال يدوي' },
  'action.prendre_photo': { fr: 'Prendre la photo', en: 'Take the photo', es: 'Tomar la foto', ar: 'التقاط الصورة' },
  'action.importer_photo': { fr: 'Choisir une photo', en: 'Choose a photo', es: 'Elegir una foto', ar: 'اختيار صورة' },
  'action.ignorer_scan': { fr: 'Remplir sans scanner', en: 'Fill in without scanning', es: 'Completar sin escanear', ar: 'الملء دون مسح' },

  'connexion.titre': { fr: 'Connexion agent', en: 'Agent sign-in', es: 'Inicio de sesión del agente', ar: 'تسجيل دخول العون' },
  'connexion.intro': { fr: 'Connectez-vous une fois avec Internet. Votre session reste ensuite utilisable hors connexion.', en: 'Sign in once with Internet access. Your session then stays usable offline.', es: 'Inicie sesión una vez con Internet. Su sesión seguirá siendo utilizable sin conexión después.', ar: 'سجّل الدخول مرة واحدة عبر الإنترنت. تبقى جلستك بعد ذلك قابلة للاستخدام دون اتصال.' },
  'connexion.email': { fr: 'Adresse e-mail', en: 'Email address', es: 'Correo electrónico', ar: 'البريد الإلكتروني' },
  'connexion.mot_de_passe': { fr: 'Mot de passe', en: 'Password', es: 'Contraseña', ar: 'كلمة المرور' },
  'connexion.valider': { fr: 'Se connecter', en: 'Sign in', es: 'Iniciar sesión', ar: 'تسجيل الدخول' },
  'connexion.en_cours': { fr: 'Connexion en cours…', en: 'Signing in…', es: 'Iniciando sesión…', ar: 'جارٍ تسجيل الدخول…' },
  'connexion.deconnexion': { fr: 'Se déconnecter', en: 'Sign out', es: 'Cerrar sesión', ar: 'تسجيل الخروج' },
  'connexion.echec_reseau': { fr: "Serveur injoignable. Vérifiez l'URL de l'API dans les réglages, ou attendez de retrouver du réseau.", en: 'Server unreachable. Check the API URL in settings, or wait until the network is back.', es: 'Servidor inalcanzable. Verifique la URL de la API en los ajustes, o espere a recuperar la red.', ar: 'الخادم غير متاح. تحقق من رابط واجهة برمجة التطبيقات في الإعدادات، أو انتظر عودة الشبكة.' },
  'connexion.identifiants_invalides': { fr: 'Adresse e-mail ou mot de passe incorrect.', en: 'Incorrect email address or password.', es: 'Correo electrónico o contraseña incorrectos.', ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
  'connexion.hors_ligne': { fr: 'Première connexion impossible hors réseau : elle doit être vérifiée par la plateforme centrale.', en: 'A first sign-in requires a network: it must be verified by the central platform.', es: 'El primer inicio de sesión no es posible sin red: debe ser verificado por la plataforma central.', ar: 'لا يمكن تسجيل الدخول الأول دون شبكة: يجب التحقق منه عبر المنصة المركزية.' },
  'connexion.session_expiree': { fr: 'Session expirée. Reconnectez-vous dès que le réseau revient.', en: 'Session expired. Sign in again as soon as the network returns.', es: 'Sesión expirada. Vuelva a iniciar sesión en cuanto regrese la red.', ar: 'انتهت صلاحية الجلسة. أعد تسجيل الدخول بمجرد عودة الشبكة.' },

  'reglages.titre': { fr: 'Réglages', en: 'Settings', es: 'Ajustes', ar: 'الإعدادات' },
  'reglages.langue': { fr: 'Langue', en: 'Language', es: 'Idioma', ar: 'اللغة' },
  'reglages.api': { fr: 'URL de la plateforme centrale', en: 'Central platform URL', es: 'URL de la plataforma central', ar: 'رابط المنصة المركزية' },
  'reglages.api_aide': { fr: 'Laissez la valeur par défaut, sauf pour tester un autre serveur.', en: 'Keep the default value, unless testing another server.', es: 'Deje el valor predeterminado, salvo para probar otro servidor.', ar: 'اترك القيمة الافتراضية، إلا لاختبار خادم آخر.' },
  'reglages.enregistres': { fr: 'Réglages enregistrés.', en: 'Settings saved.', es: 'Ajustes guardados.', ar: 'تم حفظ الإعدادات.' },
  'reglages.tester': { fr: 'Tester la connexion', en: 'Test the connection', es: 'Probar la conexión', ar: 'اختبار الاتصال' },
  'reglages.test_encours': { fr: 'Test en cours…', en: 'Testing…', es: 'Prueba en curso…', ar: 'جارٍ الاختبار…' },
  'reglages.test_ok': { fr: 'Plateforme centrale joignable.', en: 'Central platform reachable.', es: 'Plataforma central accesible.', ar: 'المنصة المركزية متاحة.' },
  'reglages.test_echec': { fr: 'Plateforme injoignable depuis cet appareil.', en: 'Platform unreachable from this device.', es: 'Plataforma inaccesible desde este dispositivo.', ar: 'المنصة غير متاحة من هذا الجهاز.' },
  'reglages.vider_cache': { fr: 'Recharger la dernière version', en: 'Reload the latest version', es: 'Recargar la última versión', ar: 'إعادة تحميل أحدث إصدار' },
  'reglages.vider_cache_aide': { fr: 'À utiliser si l’application semble figée sur une ancienne version.', en: 'Use this if the app seems stuck on an older version.', es: 'Úselo si la aplicación parece bloqueada en una versión anterior.', ar: 'استخدم هذا إذا بدا التطبيق عالقًا في إصدار قديم.' },

  'tdb.bonjour': { fr: 'Poste vétérinaire', en: 'Veterinary post', es: 'Puesto veterinario', ar: 'المركز البيطري' },
  'tdb.stock': { fr: 'Passeports vierges', en: 'Blank passports', es: 'Pasaportes en blanco', ar: 'جوازات سفر فارغة' },
  'tdb.emis_jour': { fr: 'Émis aujourd’hui', en: 'Issued today', es: 'Emitidos hoy', ar: 'صادرة اليوم' },
  'tdb.en_attente': { fr: 'À synchroniser', en: 'To synchronise', es: 'Por sincronizar', ar: 'بانتظار المزامنة' },
  'tdb.derniere_synchro': { fr: 'Dernière synchronisation', en: 'Last synchronisation', es: 'Última sincronización', ar: 'آخر مزامنة' },
  'tdb.jamais': { fr: 'jamais', en: 'never', es: 'nunca', ar: 'أبدًا' },
  'tdb.nouvelle_emission': { fr: 'Nouvelle émission', en: 'New issuance', es: 'Nueva emisión', ar: 'إصدار جديد' },
  'tdb.rafraichir_stock': { fr: 'Mettre à jour le stock', en: 'Update stock', es: 'Actualizar el inventario', ar: 'تحديث المخزون' },
  'tdb.stock_mis_a_jour': { fr: 'Stock de passeports vierges mis à jour.', en: 'Blank passport stock updated.', es: 'Inventario de pasaportes en blanco actualizado.', ar: 'تم تحديث مخزون جوازات السفر الفارغة.' },
  'tdb.stock_vide_titre': { fr: 'Aucun passeport vierge en réserve', en: 'No blank passport in stock', es: 'Ningún pasaporte en blanco en reserva', ar: 'لا يوجد جواز سفر فارغ في المخزون' },
  'tdb.stock_vide_texte': { fr: 'Connectez-vous au réseau une fois pour télécharger les passeports attribués à votre poste. Ils resteront ensuite disponibles hors connexion.', en: 'Connect to the network once to download the passports allocated to your post. They then stay available offline.', es: 'Conéctese a la red una vez para descargar los pasaportes asignados a su puesto. Luego seguirán disponibles sin conexión.', ar: 'اتصل بالشبكة مرة واحدة لتنزيل جوازات السفر المخصصة لمركزك. ستبقى بعد ذلك متاحة دون اتصال.' },
  'tdb.stock_conserve': { fr: 'La plateforme ne renvoie aucun passeport vierge : votre stock déjà téléchargé a été conservé.', en: 'The platform returned no blank passport: your already downloaded stock has been kept.', es: 'La plataforma no devuelve ningún pasaporte en blanco: se conservó su inventario ya descargado.', ar: 'لم تُرجع المنصة أي جواز سفر فارغ: تم الاحتفاظ بمخزونك المحمَّل مسبقًا.' },
  'tdb.diagnostic_stock': { fr: 'Analyser le stock', en: 'Analyse stock', es: 'Analizar el inventario', ar: 'تحليل المخزون' },
  'tdb.diagnostic_en_cours': { fr: 'Analyse en cours…', en: 'Analysing…', es: 'Analizando…', ar: 'جارٍ التحليل…' },
  'tdb.diagnostic_titre': { fr: 'Résultat de l’analyse', en: 'Analysis result', es: 'Resultado del análisis', ar: 'نتيجة التحليل' },
  'tdb.diag_role_invalide': { fr: 'Ce compte n’a pas le rôle « agent d’émission » : la plateforme refuse de lui livrer un stock de passeports. Demandez à l’administrateur national de corriger le rôle du compte.', en: 'This account does not have the “issuance agent” role, so the platform refuses to deliver a passport stock. Ask the national administrator to fix the account role.', es: 'Esta cuenta no tiene el rol «agente de emisión»: la plataforma se niega a entregarle un inventario de pasaportes. Pida al administrador nacional que corrija el rol de la cuenta.', ar: 'لا يملك هذا الحساب دور «عون الإصدار»: ترفض المنصة تزويده بمخزون من جوازات السفر. اطلب من المسؤول الوطني تصحيح دور الحساب.' },
  'tdb.diag_aucun_passeport': { fr: 'Aucun passeport n’existe pour le pays rattaché à ce compte. Soit le compte est rattaché au mauvais pays, soit aucun lot n’a encore été attribué.', en: 'No passport exists for the country linked to this account. Either the account is linked to the wrong country, or no batch has been allocated yet.', es: 'No existe ningún pasaporte para el país vinculado a esta cuenta. O bien la cuenta está vinculada al país equivocado, o aún no se ha asignado ningún lote.', ar: 'لا يوجد جواز سفر للبلد المرتبط بهذا الحساب. إما أن الحساب مرتبط ببلد خاطئ، أو لم يتم تخصيص أي دفعة بعد.' },
  'tdb.diag_aucun_vierge': { fr: 'Des passeports existent pour votre pays, mais aucun n’est au statut « vierge » — seul ce statut est distribué aux agents. Les lots encore « préchargés » doivent d’abord être confirmés à l’impression.', en: 'Passports exist for your country, but none is in “blank” status — only that status is distributed to agents. Batches still “preloaded” must first be confirmed as printed.', es: 'Existen pasaportes para su país, pero ninguno está en estado «en blanco» — solo ese estado se distribuye a los agentes. Los lotes aún «precargados» deben confirmarse primero en la impresión.', ar: 'توجد جوازات سفر لبلدك، لكن لا يوجد أي منها بحالة «فارغ» — هذه الحالة وحدها تُوزَّع على الأعوان. يجب أولاً تأكيد الدفعات التي لا تزال «محمَّلة مسبقًا» عند الطباعة.' },
  'tdb.diag_ok': { fr: 'Des passeports vierges sont bien disponibles côté plateforme. Mettez le stock à jour pour les récupérer.', en: 'Blank passports are available on the platform. Update the stock to retrieve them.', es: 'Hay pasaportes en blanco disponibles en la plataforma. Actualice el inventario para recuperarlos.', ar: 'توجد جوازات سفر فارغة متاحة على المنصة. حدّث المخزون لاسترجاعها.' },
  'tdb.diag_indisponible': { fr: 'L’analyse n’a pas pu aboutir. Vérifiez la connexion à la plateforme puis réessayez.', en: 'The analysis could not complete. Check the platform connection and try again.', es: 'El análisis no pudo completarse. Verifique la conexión con la plataforma y vuelva a intentarlo.', ar: 'تعذر إتمام التحليل. تحقق من الاتصال بالمنصة ثم أعد المحاولة.' },
  'tdb.diag_repartition': { fr: 'Répartition par statut', en: 'Breakdown by status', es: 'Distribución por estado', ar: 'التوزيع حسب الحالة' },
  'tdb.historique': { fr: 'Émissions enregistrées', en: 'Recorded issuances', es: 'Emisiones registradas', ar: 'الإصدارات المسجَّلة' },
  'tdb.historique_vide': { fr: 'Vos émissions apparaîtront ici, même sans réseau.', en: 'Your issuances will appear here, even without a network.', es: 'Sus emisiones aparecerán aquí, incluso sin red.', ar: 'ستظهر إصداراتك هنا، حتى دون شبكة.' },
  'tdb.file_synchro': { fr: 'File de synchronisation', en: 'Synchronisation queue', es: 'Cola de sincronización', ar: 'قائمة انتظار المزامنة' },
  'tdb.synchroniser': { fr: 'Synchroniser maintenant', en: 'Synchronise now', es: 'Sincronizar ahora', ar: 'المزامنة الآن' },
  'tdb.synchro_en_cours': { fr: 'Synchronisation…', en: 'Synchronising…', es: 'Sincronizando…', ar: 'جارٍ المزامنة…' },
  'tdb.synchro_terminee': { fr: 'Émissions transmises à la plateforme.', en: 'Issuances sent to the platform.', es: 'Emisiones enviadas a la plataforma.', ar: 'تم إرسال الإصدارات إلى المنصة.' },
  'tdb.synchro_hors_ligne': { fr: 'Pas de réseau : les émissions partiront automatiquement au retour de la connexion.', en: 'No network: issuances will be sent automatically when the connection returns.', es: 'Sin red: las emisiones se enviarán automáticamente cuando vuelva la conexión.', ar: 'لا توجد شبكة: سيتم إرسال الإصدارات تلقائيًا عند عودة الاتصال.' },

  'statut.en_attente': { fr: 'En attente', en: 'Pending', es: 'Pendiente', ar: 'قيد الانتظار' },
  'statut.en_cours': { fr: 'Envoi en cours', en: 'Sending', es: 'Enviando', ar: 'جارٍ الإرسال' },
  'statut.synchronisee': { fr: 'Synchronisée', en: 'Synchronised', es: 'Sincronizada', ar: 'تمت المزامنة' },
  'statut.erreur': { fr: 'Échec — sera réessayé', en: 'Failed — will retry', es: 'Fallido — se reintentará', ar: 'فشل — ستتم إعادة المحاولة' },

  'emission.titre': { fr: 'Émission d’un passeport', en: 'Passport issuance', es: 'Emisión de un pasaporte', ar: 'إصدار جواز سفر' },
  'emission.etape': { fr: 'Étape', en: 'Step', es: 'Etapa', ar: 'الخطوة' },
  'emission.sur': { fr: 'sur', en: 'of', es: 'de', ar: 'من' },
  'emission.quitter': { fr: 'Quitter l’émission', en: 'Leave issuance', es: 'Salir de la emisión', ar: 'الخروج من الإصدار' },

  'etape1.titre': { fr: 'Vérification du passeport', en: 'Passport check', es: 'Verificación del pasaporte', ar: 'التحقق من جواز السفر' },
  'etape1.intro': { fr: 'Contrôlez le document papier avant toute saisie : hologramme présent, guilloches nettes, numéro lisible, aucune page arrachée.', en: 'Check the paper document before any data entry: hologram present, crisp guilloche pattern, legible number, no torn page.', es: 'Verifique el documento de papel antes de cualquier ingreso de datos: holograma presente, guilloches nítidas, número legible, ninguna página arrancada.', ar: 'تحقق من المستند الورقي قبل أي إدخال للبيانات: وجود العلامة المائية، وضوح الزخرفة الأمنية، وضوح الرقم، عدم وجود صفحة ممزقة.' },
  'etape1.point1': { fr: 'Hologramme et guilloches conformes', en: 'Hologram and guilloche pattern compliant', es: 'Holograma y guilloches conformes', ar: 'العلامة المائية والزخرفة الأمنية مطابقتان' },
  'etape1.point2': { fr: 'Numéro du passeport lisible', en: 'Passport number legible', es: 'Número del pasaporte legible', ar: 'رقم جواز السفر واضح' },
  'etape1.point3': { fr: 'Pages 3 et 4 remplies au stylo, à l’encre noire, en MAJUSCULES', en: 'Pages 3 and 4 filled in with a black-ink pen, in CAPITALS', es: 'Páginas 3 y 4 completadas con bolígrafo, en tinta negra, en MAYÚSCULAS', ar: 'الصفحتان 3 و4 مملوءتان بقلم حبر أسود، بأحرف كبيرة' },
  'etape1.confirmer': { fr: 'Le passeport est conforme', en: 'The passport is compliant', es: 'El pasaporte es conforme', ar: 'جواز السفر مطابق' },

  'etape2.titre': { fr: 'Sélection du passeport', en: 'Passport selection', es: 'Selección del pasaporte', ar: 'اختيار جواز السفر' },
  'etape2.intro': { fr: 'Scannez le QR Code du passeport, ou saisissez son numéro. La vérification se fait sur le stock enregistré dans l’appareil, sans réseau.', en: 'Scan the passport QR code, or type its number. Verification runs against the stock stored on the device, without a network.', es: 'Escanee el código QR del pasaporte, o ingrese su número. La verificación se hace sobre el inventario guardado en el dispositivo, sin red.', ar: 'امسح رمز الاستجابة السريعة الخاص بجواز السفر، أو أدخل رقمه. يتم التحقق من المخزون المحفوظ في الجهاز، دون شبكة.' },
  'etape2.numero': { fr: 'Numéro du passeport', en: 'Passport number', es: 'Número del pasaporte', ar: 'رقم جواز السفر' },
  'etape2.rechercher': { fr: 'Vérifier ce numéro', en: 'Check this number', es: 'Verificar este número', ar: 'التحقق من هذا الرقم' },
  'etape2.authentique': { fr: 'Passeport authentique, disponible dans votre stock.', en: 'Authentic passport, available in your stock.', es: 'Pasaporte auténtico, disponible en su inventario.', ar: 'جواز سفر أصلي، متوفر في مخزونك.' },
  'etape2.inconnu': { fr: 'Ce passeport n’appartient pas au stock de votre poste. Ne l’émettez pas et signalez-le à votre hiérarchie.', en: 'This passport does not belong to your post’s stock. Do not issue it and report it to your supervisor.', es: 'Este pasaporte no pertenece al inventario de su puesto. No lo emita e infórmelo a su superior.', ar: 'لا ينتمي جواز السفر هذا إلى مخزون مركزك. لا تصدره وأبلغ رئيسك.' },
  'etape2.deja_emis': { fr: 'Ce passeport a déjà été émis depuis cet appareil.', en: 'This passport has already been issued from this device.', es: 'Este pasaporte ya fue emitido desde este dispositivo.', ar: 'تم إصدار جواز السفر هذا بالفعل من هذا الجهاز.' },

  'etape3.titre': { fr: 'Page 3 — Identification et trajet', en: 'Page 3 — Identification and route', es: 'Página 3 — Identificación y trayecto', ar: 'الصفحة 3 — الهوية والمسار' },
  'etape4.titre': { fr: 'Page 4 — Santé, cheptel et contrôle', en: 'Page 4 — Health, herd and control', es: 'Página 4 — Salud, rebaño y control', ar: 'الصفحة 4 — الصحة والقطيع والمراقبة' },
  'etape.scan_intro': { fr: 'Photographiez la page remplie au stylo. La reconnaissance se fait sur l’appareil, sans réseau, puis vous corrigez librement.', en: 'Photograph the page filled in with a pen. Recognition runs on the device, without a network, then you correct freely.', es: 'Fotografíe la página completada con bolígrafo. El reconocimiento se hace en el dispositivo, sin red, luego usted corrige libremente.', ar: 'صوّر الصفحة المملوءة بالقلم. يتم التعرف على الجهاز، دون شبكة، ثم تقوم بالتصحيح بحرية.' },
  'etape.ocr_en_cours': { fr: 'Lecture de la page…', en: 'Reading the page…', es: 'Leyendo la página…', ar: 'جارٍ قراءة الصفحة…' },
  'etape.ocr_prepare': { fr: 'Préparation du moteur de lecture…', en: 'Preparing the reading engine…', es: 'Preparando el motor de lectura…', ar: 'جارٍ تجهيز محرك القراءة…' },
  'etape.ocr_reussi': { fr: 'champ(s) pré-remplis. Vérifiez chaque valeur avant de continuer.', en: 'field(s) pre-filled. Check every value before continuing.', es: 'campo(s) precompletados. Verifique cada valor antes de continuar.', ar: 'حقل (حقول) مُعبَّأة مسبقًا. تحقق من كل قيمة قبل المتابعة.' },
  'etape.ocr_aucun': { fr: 'Aucun champ n’a pu être lu sur cette photo. Reprenez la photo à plat, bien éclairée, ou saisissez les données à la main.', en: 'No field could be read from this photo. Retake it flat and well lit, or enter the data manually.', es: 'Ningún campo pudo leerse en esta foto. Vuelva a tomarla plana y bien iluminada, o ingrese los datos manualmente.', ar: 'تعذرت قراءة أي حقل من هذه الصورة. أعد التقاطها بشكل مسطح ومضاء جيدًا، أو أدخل البيانات يدويًا.' },
  'etape.ocr_mots_lus': { fr: 'mot(s) reconnu(s) sur la photo', en: 'word(s) recognised in the photo', es: 'palabra(s) reconocida(s) en la foto', ar: 'كلمة (كلمات) تم التعرف عليها في الصورة' },
  'etape.ocr_source_cloud_position': { fr: '☁️ Google Vision (lecture) + notre positionnement complet (4 marqueurs trouvés)', en: '☁️ Google Vision (reading) + our full positioning (4 markers found)', es: '☁️ Google Vision (lectura) + nuestro posicionamiento completo (4 marcadores encontrados)', ar: '☁️ Google Vision (قراءة) + نظام تموضعنا الكامل (تم العثور على 4 علامات)' },
  'etape.ocr_source_cloud_position_sans_marqueurs': { fr: '☁️ Google Vision + positionnement partiel (marqueurs non trouvés, cadre seul — moins précis)', en: '☁️ Google Vision + partial positioning (markers not found, frame only — less accurate)', es: '☁️ Google Vision + posicionamiento parcial (marcadores no encontrados, solo marco — menos preciso)', ar: '☁️ Google Vision + تموضع جزئي (لم يتم العثور على العلامات، الإطار فقط — أقل دقة)' },
  'etape.ocr_source_cloud_ancrage': { fr: '☁️ Google Vision (ancrage sur libellé, sans notre système de position)', en: '☁️ Google Vision (label anchoring, without our positioning system)', es: '☁️ Google Vision (anclaje en etiqueta, sin nuestro sistema de posicionamiento)', ar: '☁️ Google Vision (الإرساء على التسمية، دون نظام تموضعنا)' },
  'etape.ocr_source_local': { fr: '📵 Reconnaissance locale (hors-ligne ou service indisponible)', en: '📵 Local recognition (offline or service unavailable)', es: '📵 Reconocimiento local (sin conexión o servicio no disponible)', ar: '📵 التعرف المحلي (دون اتصال أو الخدمة غير متاحة)' },
  'etape.ocr_extrait': { fr: 'Texte lu (extrait)', en: 'Text read (extract)', es: 'Texto leído (extracto)', ar: 'النص المقروء (مقتطف)' },
  'etape.ocr_echec': { fr: 'La lecture automatique a échoué. Le formulaire reste entièrement utilisable à la main.', en: 'Automatic reading failed. The form remains fully usable manually.', es: 'La lectura automática falló. El formulario sigue siendo totalmente utilizable manualmente.', ar: 'فشلت القراءة الآلية. يظل النموذج قابلاً للاستخدام يدويًا بالكامل.' },

  'consult.titre': { fr: 'Passeport enregistré', en: 'Recorded passport', es: 'Pasaporte registrado', ar: 'جواز سفر مسجَّل' },
  'consult.intro': { fr: 'Données enregistrées pour ce passeport. Celles marquées « enregistré sur la plateforme » ont été relues depuis la base centrale ; les autres attendent encore leur envoi et sont lues depuis cet appareil.', en: 'Data recorded for this passport. Items marked “recorded on the platform” were read back from the central database; the others are still awaiting upload and are read from this device.', es: 'Datos registrados para este pasaporte. Los marcados «registrado en la plataforma» fueron releídos desde la base central; los demás aún esperan su envío y se leen desde este dispositivo.', ar: 'البيانات المسجَّلة لهذا الجواز. تلك المعلَّمة بـ«مسجَّل على المنصة» أُعيدت قراءتها من القاعدة المركزية؛ أما الباقي فلا يزال بانتظار الإرسال ويُقرأ من هذا الجهاز.' },
  'consult.ouvrir': { fr: 'Consulter', en: 'View', es: 'Consultar', ar: 'عرض' },
  'consult.source_locale': { fr: 'Sur cet appareil, envoi en attente', en: 'On this device, upload pending', es: 'En este dispositivo, envío pendiente', ar: 'على هذا الجهاز، الإرسال معلَّق' },
  'consult.source_serveur': { fr: 'Enregistré sur la plateforme', en: 'Recorded on the platform', es: 'Registrado en la plataforma', ar: 'مسجَّل على المنصة' },
  'consult.verifier': { fr: 'Vérifier dans la base centrale', en: 'Check in the central database', es: 'Verificar en la base central', ar: 'التحقق في القاعدة المركزية' },
  'consult.verification_en_cours': { fr: 'Vérification…', en: 'Checking…', es: 'Verificando…', ar: 'جارٍ التحقق…' },
  'consult.pages_recues': { fr: 'page(s) reçue(s) par la plateforme', en: 'page(s) received by the platform', es: 'página(s) recibida(s) por la plataforma', ar: 'صفحة (صفحات) استلمتها المنصة' },
  'consult.absent_serveur': { fr: 'Ce passeport n’est pas encore enregistré dans la base centrale. Lancez la synchronisation depuis le tableau de bord.', en: 'This passport is not yet recorded in the central database. Start synchronisation from the dashboard.', es: 'Este pasaporte aún no está registrado en la base central. Inicie la sincronización desde el panel.', ar: 'لم يُسجَّل هذا الجواز بعد في القاعدة المركزية. ابدأ المزامنة من لوحة التحكم.' },
  'consult.echec': { fr: 'La base centrale n’a pas pu être interrogée. Les données affichées viennent de cet appareil.', en: 'The central database could not be queried. The data shown comes from this device.', es: 'No se pudo consultar la base central. Los datos mostrados provienen de este dispositivo.', ar: 'تعذر الاستعلام عن القاعدة المركزية. البيانات المعروضة مصدرها هذا الجهاز.' },
  'consult.introuvable': { fr: 'Cette émission n’existe pas sur cet appareil.', en: 'This issuance does not exist on this device.', es: 'Esta emisión no existe en este dispositivo.', ar: 'هذا الإصدار غير موجود على هذا الجهاز.' },
  'consult.effectifs': { fr: 'Effectifs par espèce', en: 'Headcount by species', es: 'Efectivos por especie', ar: 'الأعداد حسب النوع' },
  'consult.aucun_effectif': { fr: 'Aucun effectif saisi.', en: 'No headcount entered.', es: 'Ningún efectivo ingresado.', ar: 'لم يتم إدخال أي عدد.' },
  'consult.aucune_vaccination': { fr: 'Aucune vaccination saisie.', en: 'No vaccination entered.', es: 'Ninguna vacunación ingresada.', ar: 'لم يتم إدخال أي تلقيح.' },
  'consult.males': { fr: 'Mâles', en: 'Males', es: 'Machos', ar: 'ذكور' },
  'consult.femelles_jeunes': { fr: 'Femelles jeunes', en: 'Young females', es: 'Hembras jóvenes', ar: 'إناث صغيرة' },
  'consult.femelles_adultes': { fr: 'Femelles adultes', en: 'Adult females', es: 'Hembras adultas', ar: 'إناث بالغة' },

  'confiance.haute': { fr: 'Lu avec confiance', en: 'Read confidently', es: 'Leído con confianza', ar: 'تمت قراءته بثقة' },
  'confiance.moyenne': { fr: 'À vérifier', en: 'To be checked', es: 'Por verificar', ar: 'للتحقق' },
  'confiance.basse': { fr: 'Peu sûr — à corriger', en: 'Unreliable — correct it', es: 'Poco fiable — corregir', ar: 'غير موثوق — يجب التصحيح' },
  'confiance.aucune': { fr: 'Non reconnu', en: 'Not recognised', es: 'No reconocido', ar: 'غير معروف' },
  'confiance.legende': { fr: 'Chaque champ lu automatiquement porte un indice de fiabilité. Rien n’est imposé : corrigez ce qui est faux.', en: 'Every automatically read field carries a reliability indicator. Nothing is imposed: correct whatever is wrong.', es: 'Cada campo leído automáticamente tiene un indicador de fiabilidad. Nada es impuesto: corrija lo que esté mal.', ar: 'يحمل كل حقل تمت قراءته تلقائيًا مؤشر موثوقية. لا شيء مفروض: صحّح ما هو خاطئ.' },

  'p3.eleveur': { fr: 'Propriétaire / éleveur', en: 'Owner / herder', es: 'Propietario / ganadero', ar: 'المالك / مربي الماشية' },
  'p3.convoyeur': { fr: 'Convoyeur', en: 'Conveyor', es: 'Transportista', ar: 'الناقل' },
  'p3.nom_prenom': { fr: 'Nom et prénom', en: 'First and last name', es: 'Nombre y apellido', ar: 'الاسم الكامل' },
  'p3.cni': { fr: 'N° CNI', en: 'National ID number', es: 'N.º de cédula', ar: 'رقم بطاقة الهوية' },
  'p3.telephone': { fr: 'Téléphone', en: 'Phone number', es: 'Teléfono', ar: 'الهاتف' },
  'p3.itineraire': { fr: 'Trajet déclaré', en: 'Declared route', es: 'Trayecto declarado', ar: 'المسار المصرَّح به' },
  'p3.pays_origine': { fr: 'Pays d’origine', en: 'Country of origin', es: 'País de origen', ar: 'بلد المنشأ' },
  'p3.pays_autre': { fr: 'Autres (hors CEMAC)', en: 'Other (outside CEMAC)', es: 'Otros (fuera de la CEMAC)', ar: 'أخرى (خارج الإيسيمو)' },
  'p3.pays_origine_autre': { fr: 'Nom du pays d’origine', en: 'Country of origin name', es: 'Nombre del país de origen', ar: 'اسم بلد المنشأ' },
  'p3.pays_destination_autre': { fr: 'Nom du pays de destination', en: 'Country of destination name', es: 'Nombre del país de destino', ar: 'اسم بلد الوجهة' },
  'p3.province_origine': { fr: 'Province / région d’origine', en: 'Province / region of origin', es: 'Provincia / región de origen', ar: 'مقاطعة / منطقة المنشأ' },
  'champ.choisir': { fr: 'Choisir…', en: 'Choose…', es: 'Elegir…', ar: 'اختر…' },
  'champ.revenir_a_la_liste': { fr: 'Revenir à la liste', en: 'Back to list', es: 'Volver a la lista', ar: 'العودة إلى القائمة' },
  'champ.saisir_manuellement': { fr: 'Nom de la localité', en: 'Locality name', es: 'Nombre de la localidad', ar: 'اسم البلدة' },
  'p3.localite_origine': { fr: 'Localité d’origine', en: 'Locality of origin', es: 'Localidad de origen', ar: 'بلدة المنشأ' },
  'p3.pays_destination': { fr: 'Pays de destination', en: 'Country of destination', es: 'País de destino', ar: 'بلد الوجهة' },
  'p3.province_destination': { fr: 'Province / région de destination', en: 'Province / region of destination', es: 'Provincia / región de destino', ar: 'مقاطعة / منطقة الوجهة' },
  'p3.localite_destination': { fr: 'Localité de destination', en: 'Locality of destination', es: 'Localidad de destino', ar: 'بلدة الوجهة' },

  'p4.effectifs': { fr: 'Composition du troupeau', en: 'Herd composition', es: 'Composición del rebaño', ar: 'تركيبة القطيع' },
  'p4.espece': { fr: 'Espèce', en: 'Species', es: 'Especie', ar: 'النوع' },
  'p4.males': { fr: 'Mâles', en: 'Males', es: 'Machos', ar: 'ذكور' },
  'p4.femelles_jeunes': { fr: 'Femelles jeunes', en: 'Young females', es: 'Hembras jóvenes', ar: 'إناث صغيرة' },
  'p4.femelles_adultes': { fr: 'Femelles adultes', en: 'Adult females', es: 'Hembras adultas', ar: 'إناث بالغة' },
  'p4.total': { fr: 'Total', en: 'Total', es: 'Total', ar: 'المجموع' },
  'p4.total_general': { fr: 'Total général du cheptel', en: 'Overall herd total', es: 'Total general del rebaño', ar: 'المجموع العام للقطيع' },
  'p4.total_auto': { fr: 'Le total de chaque ligne est recalculé automatiquement.', en: 'Each row total is recalculated automatically.', es: 'El total de cada fila se recalcula automáticamente.', ar: 'يُعاد احتساب مجموع كل صف تلقائيًا.' },
  'p4.vaccinations': { fr: 'Traitements et vaccinations', en: 'Treatments and vaccinations', es: 'Tratamientos y vacunaciones', ar: 'العلاجات والتلقيحات' },
  'p4.vaccinations_aide': { fr: 'Renseignez la date pour chaque maladie contrôlée. Laissez vide si aucun traitement n’a été réalisé.', en: 'Enter the date for each controlled disease. Leave empty if no treatment was carried out.', es: 'Indique la fecha para cada enfermedad controlada. Deje vacío si no se realizó ningún tratamiento.', ar: 'أدخل التاريخ لكل مرض خاضع للمراقبة. اتركه فارغًا إذا لم يُجرَ أي علاج.' },
  'p4.date_vaccination': { fr: 'Date', en: 'Date', es: 'Fecha', ar: 'التاريخ' },
  'p4.lieu_vaccination': { fr: 'Lieu', en: 'Place', es: 'Lugar', ar: 'المكان' },

  'espece.bovin': { fr: 'Bovins', en: 'Cattle', es: 'Bovinos', ar: 'أبقار' },
  'espece.ovin': { fr: 'Ovins', en: 'Sheep', es: 'Ovinos', ar: 'أغنام' },
  'espece.caprin': { fr: 'Caprins', en: 'Goats', es: 'Caprinos', ar: 'ماعز' },
  'espece.camelin': { fr: 'Camelins', en: 'Camels', es: 'Camélidos', ar: 'إبل' },

  'maladie.peste_petits_ruminants': { fr: 'Peste des petits ruminants', en: 'Peste des petits ruminants', es: 'Peste de los pequeños rumiantes', ar: 'طاعون المجترات الصغيرة' },
  'maladie.peripneumonie_contagieuse': { fr: 'Péripneumonie contagieuse', en: 'Contagious bovine pleuropneumonia', es: 'Perineumonía contagiosa bovina', ar: 'ذات الجنب والرئة المعدية البقرية' },
  'maladie.charbon': { fr: 'Charbon', en: 'Anthrax', es: 'Ántrax', ar: 'الجمرة الخبيثة' },
  'maladie.trypanosomiase': { fr: 'Trypanosomiase', en: 'Trypanosomiasis', es: 'Tripanosomiasis', ar: 'داء المثقبيات' },

  'recap.titre': { fr: 'Récapitulatif avant validation', en: 'Summary before validation', es: 'Resumen antes de la validación', ar: 'ملخص قبل التأكيد' },
  'recap.intro': { fr: 'Dernière vérification. Après validation, l’émission est enregistrée dans l’appareil et partira seule dès le retour du réseau.', en: 'Final check. Once validated, the issuance is stored on the device and will be sent on its own as soon as the network returns.', es: 'Última verificación. Tras la validación, la emisión se guarda en el dispositivo y se enviará sola en cuanto vuelva la red.', ar: 'التحقق الأخير. بعد التأكيد، يُحفظ الإصدار في الجهاز ويُرسَل تلقائيًا بمجرد عودة الشبكة.' },
  'recap.passeport': { fr: 'Passeport', en: 'Passport', es: 'Pasaporte', ar: 'جواز السفر' },
  'recap.position': { fr: 'Position GPS', en: 'GPS position', es: 'Posición GPS', ar: 'الموقع عبر GPS' },
  'recap.position_absente': { fr: 'non disponible', en: 'not available', es: 'no disponible', ar: 'غير متاح' },
  'recap.photos': { fr: 'Photos conservées', en: 'Photos kept', es: 'Fotos conservadas', ar: 'الصور المحفوظة' },
  'recap.valider': { fr: 'Valider l’émission', en: 'Validate the issuance', es: 'Validar la emisión', ar: 'تأكيد الإصدار' },
  'recap.enregistrement': { fr: 'Enregistrement…', en: 'Saving…', es: 'Guardando…', ar: 'جارٍ الحفظ…' },
  'recap.enregistree': { fr: 'Émission enregistrée sur l’appareil.', en: 'Issuance stored on the device.', es: 'Emisión guardada en el dispositivo.', ar: 'تم حفظ الإصدار في الجهاز.' },

  'camera.autorisation': { fr: 'Accès à la caméra refusé. Autorisez la caméra dans votre navigateur, ou choisissez une photo existante.', en: 'Camera access denied. Allow the camera in your browser, or choose an existing photo.', es: 'Acceso a la cámara denegado. Autorice la cámara en su navegador, o elija una foto existente.', ar: 'تم رفض الوصول إلى الكاميرا. اسمح باستخدام الكاميرا في متصفحك، أو اختر صورة موجودة.' },
  'camera.cadre_qr': { fr: 'Cadrez le QR Code du passeport', en: 'Frame the passport QR code', es: 'Encuadre el código QR del pasaporte', ar: 'قم بتأطير رمز الاستجابة السريعة لجواز السفر' },
  'camera.cadre_page': { fr: 'Alignez le cadre VERT imprimé sur le passeport avec ce repère — pas le bord du papier', en: "Align the passport's printed GREEN frame with this guide — not the paper edge", es: 'Alinee el marco VERDE impreso del pasaporte con esta guía — no el borde del papel', ar: 'قم بمحاذاة الإطار الأخضر المطبوع على الجواز مع هذا الدليل — وليس حافة الورقة' },
  'camera.conseil_page': { fr: 'Le cadre vert imprimé (près du bord de chaque page) doit remplir tout le repère à l\'écran. Évitez ombres et reflets — la lumière du jour sans soleil direct fonctionne mieux.', en: "The passport's printed green frame (near each page's edge) should fill the entire on-screen guide. Avoid shadows and glare — daylight without direct sun works best.", es: 'El marco verde impreso (cerca del borde de cada página) debe llenar toda la guía en pantalla. Evite sombras y reflejos — la luz del día sin sol directo funciona mejor.', ar: 'يجب أن يملأ الإطار الأخضر المطبوع (بالقرب من حافة كل صفحة) الدليل بالكامل على الشاشة. تجنب الظلال والانعكاسات — يعمل ضوء النهار دون شمس مباشرة بشكل أفضل.' },
  'camera.document_detecte': { fr: 'Document détecté — capture automatique…', en: 'Document detected — capturing automatically…', es: 'Documento detectado — captura automática…', ar: 'تم اكتشاف المستند — التقاط تلقائي…' },
  'ajustage.instruction': { fr: 'Déplacez et zoomez la photo pour la faire correspondre au cadre', en: 'Move and zoom the photo to match it to the frame', es: 'Mueva y haga zoom en la foto para que coincida con el marco', ar: 'حرّك وقرّب الصورة لمطابقتها مع الإطار' },
  'ajustage.zoom': { fr: 'Zoom', en: 'Zoom', es: 'Zoom', ar: 'التكبير' },
  'ajustage.reprendre': { fr: 'Reprendre la photo', en: 'Retake photo', es: 'Retomar la foto', ar: 'إعادة التقاط الصورة' },
  'ajustage.valider': { fr: 'Valider le cadrage', en: 'Confirm framing', es: 'Confirmar el encuadre', ar: 'تأكيد التأطير' },
  'camera.recherche_qr': { fr: 'Recherche du QR Code…', en: 'Looking for the QR code…', es: 'Buscando el código QR…', ar: 'جارٍ البحث عن رمز الاستجابة السريعة…' },

  'validation.requis': { fr: 'Ce champ est obligatoire.', en: 'This field is required.', es: 'Este campo es obligatorio.', ar: 'هذا الحقل إلزامي.' },
  'validation.champs_manquants': { fr: 'Complétez les champs obligatoires avant de continuer.', en: 'Complete the required fields before continuing.', es: 'Complete los campos obligatorios antes de continuar.', ar: 'أكمل الحقول الإلزامية قبل المتابعة.' },
  'validation.troupeau_vide': { fr: 'Renseignez au moins un animal dans le cheptel.', en: 'Enter at least one animal in the herd.', es: 'Ingrese al menos un animal en el rebaño.', ar: 'أدخل حيوانًا واحدًا على الأقل في القطيع.' },
};

interface ContexteI18n {
  langue: Langue;
  changerLangue: (l: Langue) => void;
  t: (cle: string) => string;
  apiBaseUrl: string;
  definirApiBaseUrl: (url: string) => void;
}

const Contexte = createContext<ContexteI18n | null>(null);

function lireLangue(): Langue {
  const brut = typeof localStorage !== 'undefined' ? localStorage.getItem(CLE_LANGUE) : null;
  return brut === 'en' || brut === 'es' || brut === 'ar' ? brut : 'fr';
}

/**
 * Ramène une saisie humaine à une origine exploitable.
 *
 * Sur le terrain, l'URL est tapée au pouce : espace final, slash en trop, ou
 * copie du lien de la documentation (`.../api/v1/docs`). Le client ajoutant
 * déjà le préfixe `/api/v1`, on retire tout suffixe de chemin déjà présent
 * pour éviter un `/api/v1/api/v1/...` silencieusement introuvable.
 * Renvoie une chaîne vide si la valeur n'est pas une adresse absolue.
 */
function normaliserApi(brut: string): string {
  const propre = brut.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(propre)) return '';
  return propre.replace(/\/api\/v1(\/.*)?$/i, '');
}

/**
 * Une adresse pointant vers l'application elle-même ne peut pas être l'API.
 *
 * Ce cas se produit quand une ancienne version, servie depuis le cache hors
 * connexion, a mémorisé l'adresse du proxy de développement : le POST de
 * connexion part alors vers le serveur de fichiers, qui répond « 405 Method
 * Not Allowed ». On le détecte pour retomber sur la plateforme réelle au lieu
 * d'afficher une erreur incompréhensible.
 */
function viseLApplication(url: string): boolean {
  return typeof location !== 'undefined' && url === location.origin;
}

function lireApi(): string {
  if (typeof localStorage === 'undefined') return API_PAR_DEFAUT;
  const enregistre = normaliserApi(localStorage.getItem(CLE_API) ?? '');
  if (!enregistre || viseLApplication(enregistre)) return API_PAR_DEFAUT;
  return enregistre;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [langue, setLangue] = useState<Langue>(lireLangue);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(lireApi);

  useEffect(() => {
    document.documentElement.lang = langue;
    // Voir styles/rtl.css (même principe que le web) pour l'inversion de
    // mise en page sous [dir="rtl"].
    document.documentElement.dir = langue === 'ar' ? 'rtl' : 'ltr';
  }, [langue]);

  const changerLangue = useCallback((l: Langue) => {
    localStorage.setItem(CLE_LANGUE, l);
    setLangue(l);
  }, []);

  const definirApiBaseUrl = useCallback((url: string) => {
    // Une saisie inutilisable ne doit jamais remplacer une adresse qui marche :
    // on retombe sur la plateforme par défaut plutôt que d'enregistrer un
    // fragment qui ferait échouer toutes les connexions suivantes.
    const candidat = normaliserApi(url);
    const propre = !candidat || viseLApplication(candidat) ? API_PAR_DEFAUT : candidat;
    localStorage.setItem(CLE_API, propre);
    setApiBaseUrl(propre);
  }, []);

  const valeur = useMemo<ContexteI18n>(
    () => ({
      langue,
      changerLangue,
      apiBaseUrl,
      definirApiBaseUrl,
      t: (cle: string) => DICO[cle]?.[langue] ?? cle,
    }),
    [langue, changerLangue, apiBaseUrl, definirApiBaseUrl],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useI18n(): ContexteI18n {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error('useI18n doit être utilisé dans I18nProvider.');
  return contexte;
}

/** URL de base courante, lisible hors composant React (client API, synchro). */
export function apiBaseUrlCourante(): string {
  return lireApi();
}