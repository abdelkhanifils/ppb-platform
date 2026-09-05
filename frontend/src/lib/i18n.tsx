/**
 * Internationalisation FR/EN/ES/AR — même patron que mobile/src/lib/i18n.tsx
 * (dictionnaire de clés, hook useI18n, provider), pour que les deux
 * applications se comportent de la même façon du point de vue de l'agent :
 * un même sélecteur, une même persistance de préférence, un même principe
 * (langue de l'INTERFACE seulement — les libellés IMPRIMÉS du passeport
 * papier, ancres de l'OCR, restent en français quel que soit ce réglage).
 *
 * L'arabe s'affiche de droite à gauche (voir I18nProvider, qui bascule
 * `document.documentElement.dir`) — la mise en page (position du menu,
 * alignements, marges) suit via styles/rtl.css, une feuille de style
 * globale qui réinterprète les classes Tailwind physiques usuelles
 * (ml-*, mr-*, text-left, text-right, left-*, right-*, rounded-l-*,
 * rounded-r-*, border-l, border-r) sous [dir="rtl"] — aucun composant
 * existant n'a eu besoin d'être modifié un par un pour ce basculement.
 * Limite assumée : les cas non couverts par cette feuille (mise en page
 * très spécifique à un composant précis) peuvent nécessiter un ajustement
 * ponctuel si repérés à l'usage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Langue = "fr" | "en" | "es" | "ar";

const CLE_LANGUE = "ppb_admin.langue";

type Entree = { fr: string; en: string; es: string; ar: string };

const DICO: Record<string, Entree> = {
  // --- Mise en page partagée (layouts/TableauDeBordLayout.tsx) ---
  "nav.tableau_bord": { fr: "Tableau de bord", en: "Dashboard", es: "Panel de control", ar: "لوحة التحكم" },
  "nav.commandes": { fr: "Commandes", en: "Orders", es: "Pedidos", ar: "الطلبات" },
  "nav.paiements": { fr: "Paiements", en: "Payments", es: "Pagos", ar: "المدفوعات" },
  "nav.impression": { fr: "Impression", en: "Printing", es: "Impresión", ar: "الطباعة" },
  "nav.emission": { fr: "Émission terrain", en: "Field issuance", es: "Emisión de campo", ar: "الإصدار الميداني" },
  "nav.controle": { fr: "Contrôle frontière", en: "Border control", es: "Control fronterizo", ar: "مراقبة الحدود" },
  "nav.vaccinations": { fr: "Vaccinations", en: "Vaccinations", es: "Vacunaciones", ar: "التلقيحات" },
  "nav.administration": { fr: "Administration", en: "Administration", es: "Administración", ar: "الإدارة" },
  "nav.statistiques": { fr: "Statistiques", en: "Statistics", es: "Estadísticas", ar: "الإحصائيات" },
  "layout.deconnexion": { fr: "Déconnexion", en: "Log out", es: "Cerrar sesión", ar: "تسجيل الخروج" },
  "layout.ouvrir_menu": { fr: "Ouvrir le menu", en: "Open menu", es: "Abrir el menú", ar: "فتح القائمة" },
  "layout.fermer_menu": { fr: "Fermer le menu", en: "Close menu", es: "Cerrar el menú", ar: "إغلاق القائمة" },
  "notifications.titre": { fr: "Notifications", en: "Notifications", es: "Notificaciones", ar: "الإشعارات" },
  "notifications.aucune": { fr: "Aucune notification.", en: "No notifications.", es: "Sin notificaciones.", ar: "لا توجد إشعارات." },
  "notifications.tout_marquer_lu": { fr: "Tout marquer comme lu", en: "Mark all as read", es: "Marcar todo como leído", ar: "تعليم الكل كمقروء" },

  // --- Connexion (pages/Connexion.tsx) ---
  "connexion.organisme": { fr: "CEBEVIRHA — Plateforme numérique du PPB", en: "CEBEVIRHA — PPB digital platform", es: "CEBEVIRHA — Plataforma digital del PPB", ar: "CEBEVIRHA — المنصة الرقمية لجواز سفر الماشية" },
  "connexion.email": { fr: "Email", en: "Email", es: "Correo electrónico", ar: "البريد الإلكتروني" },
  "connexion.mot_de_passe": { fr: "Mot de passe", en: "Password", es: "Contraseña", ar: "كلمة المرور" },
  "connexion.se_connecter": { fr: "Se connecter", en: "Log in", es: "Iniciar sesión", ar: "تسجيل الدخول" },
  "connexion.en_cours": { fr: "Connexion…", en: "Logging in…", es: "Iniciando sesión…", ar: "جارٍ تسجيل الدخول…" },
  "connexion.erreur": { fr: "Email ou mot de passe incorrect.", en: "Incorrect email or password.", es: "Correo electrónico o contraseña incorrectos.", ar: "البريد الإلكتروني أو كلمة المرور غير صحيحة." },
  "connexion.hors_ligne_premiere_fois": { fr: "Pas de connexion réseau. La toute première connexion sur cet appareil nécessite Internet (le mot de passe doit être vérifié) ; une fois connecté une première fois, vous pourrez rouvrir l'application hors-ligne.", en: "No network connection. The very first login on this device requires internet (the password must be verified); once logged in once, you'll be able to reopen the app offline.", es: "Sin conexión de red. El primer inicio de sesión en este dispositivo requiere Internet (la contraseña debe verificarse); una vez conectado por primera vez, podrá reabrir la aplicación sin conexión.", ar: "لا يوجد اتصال بالشبكة. يتطلب أول تسجيل دخول على هذا الجهاز اتصالاً بالإنترنت (يجب التحقق من كلمة المرور)؛ بمجرد تسجيل الدخول لأول مرة، ستتمكن من إعادة فتح التطبيق دون اتصال." },

  // --- Sélecteur de langue ---
  "langue.libelle": { fr: "Langue", en: "Language", es: "Idioma", ar: "اللغة" },
  "langue.francais": { fr: "Français", en: "French", es: "Francés", ar: "الفرنسية" },
  "langue.anglais": { fr: "English", en: "English", es: "Inglés", ar: "الإنجليزية" },

  // --- Module 4 — Émission terrain (pages/EmissionTerrain.tsx + emission/*) ---
  "emission.titre": { fr: "Émission terrain", en: "Field issuance", es: "Emisión de campo", ar: "الإصدار الميداني" },
  "emission.succes": { fr: "Passeport {numero} enregistré avec succès — prêt pour le suivant.", en: "Passport {numero} saved successfully — ready for the next one.", es: "Pasaporte {numero} guardado con éxito — listo para el siguiente.", ar: "تم حفظ جواز السفر {numero} بنجاح — جاهز للتالي." },
  "emission.page_sur": { fr: "Page {page} sur 4", en: "Page {page} of 4", es: "Página {page} de 4", ar: "الصفحة {page} من 4" },
  "emission.annuler": { fr: "Annuler", en: "Cancel", es: "Cancelar", ar: "إلغاء" },
  "emission.liste_repliee": { fr: "Pas le document sous la main ? Choisir dans la liste préchargée", en: "Don't have the document at hand? Choose from the preloaded list", es: "¿No tiene el documento a mano? Elegir de la lista precargada", ar: "ألا تملك المستند في متناول يدك؟ اختر من القائمة المحملة مسبقًا" },
  "emission.actualiser": { fr: "Actualiser", en: "Refresh", es: "Actualizar", ar: "تحديث" },
  "emission.liste_vide": { fr: "Aucun passeport préchargé localement. Connectez-vous puis actualisez.", en: "No passport preloaded locally. Connect then refresh.", es: "Ningún pasaporte precargado localmente. Conéctese y luego actualice.", ar: "لا يوجد جواز سفر محمّل مسبقًا محليًا. اتصل ثم قم بالتحديث." },
  "emission.reprendre": { fr: "Reprendre →", en: "Resume →", es: "Reanudar →", ar: "استئناف ←" },

  "sync.en_ligne": { fr: "En ligne", en: "Online", es: "En línea", ar: "متصل" },
  "sync.en_cours": { fr: "Synchronisation en cours…", en: "Syncing…", es: "Sincronizando…", ar: "جارٍ المزامنة…" },
  "sync.hors_ligne": { fr: "Hors-ligne — les saisies sont conservées localement", en: "Offline — entries are kept locally", es: "Sin conexión — los datos se guardan localmente", ar: "غير متصل — يتم حفظ الإدخالات محليًا" },
  "sync.voir_detail": { fr: "Voir le détail", en: "Show details", es: "Ver detalle", ar: "عرض التفاصيل" },
  "sync.masquer_detail": { fr: "Masquer le détail", en: "Hide details", es: "Ocultar detalle", ar: "إخفاء التفاصيل" },
  "sync.en_echec": { fr: "{n} en échec — réessayer", en: "{n} failed — retry", es: "{n} fallido(s) — reintentar", ar: "{n} فشل(ت) — إعادة المحاولة" },
  "sync.erreur_inconnue": { fr: "Erreur inconnue", en: "Unknown error", es: "Error desconocido", ar: "خطأ غير معروف" },
  "sync.page_passeport": { fr: "Page {page} — passeport {id}… ({n} tentative{s})", en: "Page {page} — passport {id}… ({n} attempt{s})", es: "Página {page} — pasaporte {id}… ({n} intento{s})", ar: "الصفحة {page} — جواز السفر {id}… (محاولة {n}{s})" },

  "page1.titre": { fr: "1 · Vérification visuelle", en: "1 · Visual check", es: "1 · Verificación visual", ar: "1 · التحقق البصري" },
  "page1.intro": { fr: "Contrôlez le document physique avant de continuer — aucune photo n'est prise à cette étape.", en: "Check the physical document before continuing — no photo is taken at this step.", es: "Verifique el documento físico antes de continuar — no se toma ninguna foto en esta etapa.", ar: "تحقق من المستند المادي قبل المتابعة — لا يتم التقاط أي صورة في هذه المرحلة." },
  "page1.critere_numero": { fr: "Le numéro imprimé correspond au lot remis (Pays-Année-N° de lot)", en: "The printed number matches the batch handed over (Country-Year-Batch No.)", es: "El número impreso coincide con el lote entregado (País-Año-N.º de lote)", ar: "الرقم المطبوع يطابق الدفعة المسلَّمة (البلد-السنة-رقم الدفعة)" },
  "page1.critere_qr": { fr: "Le QR Code de validation est présent et net", en: "The validation QR Code is present and clear", es: "El código QR de validación está presente y es legible", ar: "رمز الاستجابة السريعة للتحقق موجود وواضح" },
  "page1.critere_zone": { fr: "La zone de lecture automatique n'est pas endommagée", en: "The automatic reading zone is not damaged", es: "La zona de lectura automática no está dañada", ar: "منطقة القراءة الآلية غير تالفة" },
  "page1.critere_securite": { fr: "Le guilloché et les éléments de sécurité sont visibles", en: "The guilloche pattern and security features are visible", es: "El fondo de seguridad y los elementos de seguridad son visibles", ar: "الزخرفة الأمنية وعناصر الأمان ظاهرة" },
  "page1.valider": { fr: "Document conforme — continuer", en: "Document compliant — continue", es: "Documento conforme — continuar", ar: "المستند مطابق — متابعة" },
  "page1.validation": { fr: "Validation…", en: "Saving…", es: "Guardando…", ar: "جارٍ الحفظ…" },

  "page2.titre": { fr: "Scan du QR Code", en: "QR Code scan", es: "Escaneo del código QR", ar: "مسح رمز الاستجابة السريعة" },
  "page2.intro": { fr: "Visez le QR Code de validation en page 2 du document.", en: "Aim at the validation QR Code on page 2 of the document.", es: "Apunte al código QR de validación en la página 2 del documento.", ar: "وجّه الكاميرا نحو رمز الاستجابة السريعة للتحقق في الصفحة 2 من المستند." },
  "page2.verification": { fr: "Vérification…", en: "Checking…", es: "Verificando…", ar: "جارٍ التحقق…" },
  "page2.camera_indisponible": { fr: "Caméra indisponible — utilisez la saisie manuelle ci-dessous.", en: "Camera unavailable — use the manual entry below.", es: "Cámara no disponible — use la entrada manual a continuación.", ar: "الكاميرا غير متاحة — استخدم الإدخال اليدوي أدناه." },
  "page2.aucun_passeport": { fr: "Ce QR ne correspond à aucun passeport préchargé pour vous. Rafraîchissez la liste si vous êtes en ligne.", en: "This QR doesn't match any passport preloaded for you. Refresh the list if you're online.", es: "Este QR no corresponde a ningún pasaporte precargado para usted. Actualice la lista si está en línea.", ar: "لا يتوافق رمز الاستجابة هذا مع أي جواز سفر محمّل مسبقًا لك. حدّث القائمة إذا كنت متصلًا." },
  "page2.saisie_manuelle": { fr: "Caméra indisponible ? Saisie manuelle", en: "Camera unavailable? Manual entry", es: "¿Cámara no disponible? Entrada manual", ar: "الكاميرا غير متاحة؟ إدخال يدوي" },
  "page2.placeholder_uuid": { fr: "UUID du QR Code", en: "QR Code UUID", es: "UUID del código QR", ar: "المعرف الفريد لرمز الاستجابة السريعة" },
  "page2.valider": { fr: "Valider", en: "Confirm", es: "Confirmar", ar: "تأكيد" },

  "page3.titre": { fr: "3 · Éleveur, convoyeur et itinéraire", en: "3 · Owner, conveyor and route", es: "3 · Propietario, transportista e itinerario", ar: "3 · المالك والناقل ومسار الرحلة" },
  "page3.proprietaire": { fr: "Propriétaire", en: "Owner", es: "Propietario", ar: "المالك" },
  "page3.convoyeur": { fr: "Convoyeur", en: "Conveyor", es: "Transportista", ar: "الناقل" },
  "page3.nom_prenom": { fr: "Nom et prénom", en: "Full name", es: "Nombre y apellido", ar: "الاسم الكامل" },
  "page3.nom_prenom_oblig": { fr: "Nom et prénom *", en: "Full name *", es: "Nombre y apellido *", ar: "الاسم الكامل *" },
  "page3.cni": { fr: "N° CNI", en: "ID card no.", es: "N.º de cédula", ar: "رقم بطاقة الهوية" },
  "page3.cni_oblig": { fr: "N° CNI *", en: "ID card no. *", es: "N.º de cédula *", ar: "رقم بطاقة الهوية *" },
  "page3.telephone": { fr: "Téléphone", en: "Phone", es: "Teléfono", ar: "الهاتف" },
  "page3.itineraire": { fr: "Itinéraire déclaré", en: "Declared route", es: "Itinerario declarado", ar: "المسار المصرَّح به" },
  "page3.itineraire_intro": { fr: "Déclaré oralement par l'éleveur ou le convoyeur — détermine à lui seul la validité du passeport pour ce trajet.", en: "Declared orally by the owner or conveyor — alone determines the passport's validity for this route.", es: "Declarado oralmente por el propietario o el transportista — determina por sí solo la validez del pasaporte para este trayecto.", ar: "يُصرَّح به شفهيًا من قِبل المالك أو الناقل — يحدد وحده صلاحية جواز السفر لهذا المسار." },
  "page3.pays_origine": { fr: "Pays d'origine", en: "Country of origin", es: "País de origen", ar: "بلد المنشأ" },
  "page3.pays_autre": { fr: "Autres (hors CEMAC)", en: "Other (outside CEMAC)", es: "Otros (fuera de la CEMAC)", ar: "أخرى (خارج الإيسيمو)" },
  "page3.pays_origine_autre": { fr: "Nom du pays d'origine", en: "Country of origin name", es: "Nombre del país de origen", ar: "اسم بلد المنشأ" },
  "page3.pays_destination_autre": { fr: "Nom du pays de destination", en: "Country of destination name", es: "Nombre del país de destino", ar: "اسم بلد الوجهة" },
  "page3.pays_destination": { fr: "Pays de destination", en: "Country of destination", es: "País de destino", ar: "بلد الوجهة" },
  "page3.province_origine": { fr: "Province d'origine *", en: "Province of origin *", es: "Provincia de origen *", ar: "مقاطعة المنشأ *" },
  "page3.province_destination": { fr: "Province de destination *", en: "Province of destination *", es: "Provincia de destino *", ar: "مقاطعة الوجهة *" },
  "page3.localite_origine": { fr: "Localité d'origine", en: "Locality of origin", es: "Localidad de origen", ar: "بلدة المنشأ" },
  "page3.localite_destination": { fr: "Localité de destination", en: "Locality of destination", es: "Localidad de destino", ar: "بلدة الوجهة" },
  "page3.obligatoire": { fr: "Obligatoire", en: "Required", es: "Obligatorio", ar: "إلزامي" },
  "page3.valider": { fr: "Valider cette page", en: "Confirm this page", es: "Confirmar esta página", ar: "تأكيد هذه الصفحة" },
  "page3.validation": { fr: "Validation…", en: "Saving…", es: "Guardando…", ar: "جارٍ الحفظ…" },

  "page4.titre": { fr: "4 · Composition du troupeau et vaccinations", en: "4 · Herd composition and vaccinations", es: "4 · Composición del rebaño y vacunaciones", ar: "4 · تركيبة القطيع والتلقيحات" },
  "page4.composition": { fr: "Composition par espèce", en: "Composition by species", es: "Composición por especie", ar: "التركيبة حسب النوع" },
  "page4.espece": { fr: "Espèce", en: "Species", es: "Especie", ar: "النوع" },
  "page4.males": { fr: "Mâles", en: "Males", es: "Machos", ar: "ذكور" },
  "page4.femelles_jeunes": { fr: "Femelles jeunes", en: "Young females", es: "Hembras jóvenes", ar: "إناث صغيرة" },
  "page4.femelles_adultes": { fr: "Femelles adultes", en: "Adult females", es: "Hembras adultas", ar: "إناث بالغة" },
  "page4.total": { fr: "Total", en: "Total", es: "Total", ar: "المجموع" },
  "page4.ajouter_espece": { fr: "Ajouter une espèce", en: "Add a species", es: "Agregar una especie", ar: "إضافة نوع" },
  "page4.effectif_vide": { fr: "Au moins une espèce doit avoir un effectif non nul.", en: "At least one species must have a non-zero count.", es: "Al menos una especie debe tener un número no nulo.", ar: "يجب أن يحتوي نوع واحد على الأقل على عدد غير صفري." },
  "page4.vaccinations": { fr: "Vaccinations réalisées ou vérifiées", en: "Vaccinations performed or checked", es: "Vacunaciones realizadas o verificadas", ar: "التلقيحات المنجزة أو المتحقق منها" },
  "page4.lieu": { fr: "Lieu", en: "Location", es: "Lugar", ar: "المكان" },
  "page4.complementaires": { fr: "Informations complémentaires", en: "Additional information", es: "Información adicional", ar: "معلومات إضافية" },
  "page4.valider": { fr: "Valider et clôturer l'émission", en: "Confirm and complete issuance", es: "Confirmar y finalizar la emisión", ar: "تأكيد وإنهاء الإصدار" },
  "page4.validation": { fr: "Validation…", en: "Saving…", es: "Guardando…", ar: "جارٍ الحفظ…" },
  "page4.bovins": { fr: "Bovins", en: "Cattle", es: "Bovinos", ar: "أبقار" },
  "page4.ovins": { fr: "Ovins", en: "Sheep", es: "Ovinos", ar: "أغنام" },
  "page4.caprins": { fr: "Caprins", en: "Goats", es: "Caprinos", ar: "ماعز" },
  "page4.camelins": { fr: "Camelins", en: "Camels", es: "Camélidos", ar: "إبل" },
  "page4.autres": { fr: "Autres", en: "Other", es: "Otros", ar: "أخرى" },
  "page4.peste_petits_ruminants": { fr: "Peste des Petits Ruminants", en: "Peste des Petits Ruminants", es: "Peste de los Pequeños Rumiantes", ar: "طاعون المجترات الصغيرة" },
  "page4.peripneumonie": { fr: "Péripneumonie contagieuse", en: "Contagious pleuropneumonia", es: "Perineumonía contagiosa", ar: "ذات الجنب والرئة المعدية" },
  "page4.charbon": { fr: "Charbon", en: "Anthrax", es: "Ántrax", ar: "الجمرة الخبيثة" },
  "page4.trypanosomiase": { fr: "Trypanosomiase", en: "Trypanosomiasis", es: "Tripanosomiasis", ar: "داء المثقبيات" },

  // --- Commun (partagé entre plusieurs écrans) ---
  "commun.chargement": { fr: "Chargement…", en: "Loading…", es: "Cargando…", ar: "جارٍ التحميل…" },
  "commun.pays": { fr: "Pays", en: "Country", es: "País", ar: "البلد" },
  "action.annuler": { fr: "Annuler", en: "Cancel", es: "Cancelar", ar: "إلغاء" },
  "action.continuer": { fr: "Continuer", en: "Continue", es: "Continuar", ar: "متابعة" },
  "action.creer": { fr: "Créer", en: "Create", es: "Crear", ar: "إنشاء" },

  // --- Accès refusé (pages/AccesRefuse.tsx) ---
  "acces_refuse.titre": { fr: "Accès refusé", en: "Access denied", es: "Acceso denegado", ar: "الوصول مرفوض" },
  "acces_refuse.texte": { fr: "Votre rôle ne permet pas d'accéder à cette page.", en: "Your role does not allow access to this page.", es: "Su rol no permite acceder a esta página.", ar: "دورك لا يسمح بالوصول إلى هذه الصفحة." },
  "acces_refuse.retour": { fr: "Retour au tableau de bord", en: "Back to dashboard", es: "Volver al panel de control", ar: "العودة إلى لوحة التحكم" },

  // --- Vaccinations (pages/Vaccinations.tsx) ---
  "vaccinations.description": { fr: "Validation des informations sanitaires et certificats de vaccination.", en: "Validation of health information and vaccination certificates.", es: "Validación de la información sanitaria y certificados de vacunación.", ar: "التحقق من المعلومات الصحية وشهادات التلقيح." },
  "vaccinations.a_implementer": { fr: "Écran à implémenter — structure de route déjà branchée et protégée par rôle.", en: "Screen to be implemented — route already wired and role-protected.", es: "Pantalla por implementar — ruta ya configurada y protegida por rol.", ar: "شاشة قيد التنفيذ — المسار مُهيأ بالفعل ومحمي حسب الدور." },

  // --- Contrôle frontière (pages/ControleFrontiere.tsx) ---
  "controle.aucun_passeport": { fr: "Ce QR ne correspond à aucun passeport connu localement. Synchronisez si vous êtes en ligne.", en: "This QR doesn't match any passport known locally. Sync if you're online.", es: "Este QR no corresponde a ningún pasaporte conocido localmente. Sincronice si está en línea.", ar: "لا يتوافق رمز الاستجابة هذا مع أي جواز سفر معروف محليًا. قم بالمزامنة إذا كنت متصلًا." },
  "controle.cle_indisponible": { fr: "Clé publique de vérification indisponible localement — synchronisez avant de continuer.", en: "Verification public key unavailable locally — sync before continuing.", es: "Clave pública de verificación no disponible localmente — sincronice antes de continuar.", ar: "المفتاح العام للتحقق غير متوفر محليًا — قم بالمزامنة قبل المتابعة." },
  "controle.identification_poste": { fr: "Identification du poste", en: "Post identification", es: "Identificación del puesto", ar: "تحديد هوية المركز" },
  "controle.identification_intro": { fr: "Renseignez l'identifiant de ce poste de contrôle avant de commencer.", en: "Enter this control post's identifier before starting.", es: "Indique el identificador de este puesto de control antes de comenzar.", ar: "أدخل معرّف مركز المراقبة هذا قبل البدء." },
  "controle.poste": { fr: "Poste : {id}", en: "Post: {id}", es: "Puesto: {id}", ar: "المركز: {id}" },
  "controle.changer_poste": { fr: "Changer de poste", en: "Change post", es: "Cambiar de puesto", ar: "تغيير المركز" },
  "controle.suivant": { fr: "Contrôle suivant", en: "Next check", es: "Siguiente control", ar: "الفحص التالي" },
  "controle.deja_scanne_ce_poste": { fr: "Ce PPB a déjà été scanné {n} fois à ce poste.", en: "This PPB has already been scanned {n} time(s) at this post.", es: "Este PPB ya fue escaneado {n} vez/veces en este puesto.", ar: "تم مسح جواز سفر الماشية هذا {n} مرة (مرات) في هذا المركز." },
  "controle.verifiez_document_physique": { fr: "Vérifiez attentivement le document physique et le troupeau avant de continuer.", en: "Carefully check the physical document and the herd before continuing.", es: "Verifique cuidadosamente el documento físico y el rebaño antes de continuar.", ar: "تحقق بعناية من المستند المادي والقطيع قبل المتابعة." },
  "controle.motif_obligatoire_titre": { fr: "Motif obligatoire", en: "Reason required", es: "Motivo obligatorio", ar: "السبب إلزامي" },
  "controle.motif_obligatoire_explication": { fr: "Ce PPB a déjà été scanné à ce poste il y a plus de 10 minutes. Indiquez pourquoi vous validez ce passage avant de continuer.", en: "This PPB was already scanned at this post more than 10 minutes ago. State why you are validating this crossing before continuing.", es: "Este PPB ya fue escaneado en este puesto hace más de 10 minutos. Indique por qué valida este paso antes de continuar.", ar: "تم مسح جواز سفر الماشية هذا في هذا المركز منذ أكثر من 10 دقائق. اذكر سبب مصادقتك على هذا العبور قبل المتابعة." },
  "controle.motif_placeholder": { fr: "Ex. : le troupeau a dû rebrousser chemin pour...", en: "E.g.: the herd had to turn back because...", es: "Ej.: el rebaño tuvo que regresar porque...", ar: "مثال: اضطر القطيع للعودة بسبب..." },
  "controle.confirmer_avec_motif": { fr: "Confirmer avec ce motif", en: "Confirm with this reason", es: "Confirmar con este motivo", ar: "تأكيد بهذا السبب" },
  "controle.verification_en_cours": { fr: "Vérification en cours…", en: "Checking…", es: "Verificando…", ar: "جارٍ التحقق…" },
  "controle.reessayer": { fr: "Réessayer", en: "Retry", es: "Reintentar", ar: "إعادة المحاولة" },
  "controle.placeholder_poste": { fr: "Ex. poste-kousseri", en: "E.g. post-kousseri", es: "Ej. poste-kousseri", ar: "مثال poste-kousseri" },
  "controle.hors_ligne": { fr: "Hors-ligne — vérifications locales toujours actives", en: "Offline — local checks still active", es: "Sin conexión — las verificaciones locales siguen activas", ar: "غير متصل — التحققات المحلية لا تزال نشطة" },
  "controle.en_attente_envoi": { fr: "{n} en attente d'envoi", en: "{n} awaiting upload", es: "{n} pendiente(s) de envío", ar: "{n} في انتظار الإرسال" },

  // --- Commandes (pages/Commandes.tsx) ---
  "commandes.description": { fr: "Passer et suivre les commandes de PPB.", en: "Place and track PPB orders.", es: "Realizar y seguir los pedidos de PPB.", ar: "إصدار ومتابعة طلبات جواز سفر الماشية." },
  "commandes.erreur_chargement": { fr: "Impossible de charger les commandes.", en: "Unable to load orders.", es: "No se pudieron cargar los pedidos.", ar: "تعذر تحميل الطلبات." },
  "commandes.nouvelle": { fr: "Nouvelle commande", en: "New order", es: "Nuevo pedido", ar: "طلب جديد" },
  "commandes.quantite": { fr: "Quantité", en: "Quantity", es: "Cantidad", ar: "الكمية" },
  "commandes.langue": { fr: "Langue", en: "Language", es: "Idioma", ar: "اللغة" },
  "commandes.montant": { fr: "Montant (XAF)", en: "Amount (XAF)", es: "Monto (XAF)", ar: "المبلغ (XAF)" },
  "commandes.statut": { fr: "Statut", en: "Status", es: "Estado", ar: "الحالة" },
  "commandes.responsable": { fr: "Responsable", en: "Responsible party", es: "Responsable", ar: "المسؤول" },
  "commandes.aucune": { fr: "Aucune commande pour l'instant.", en: "No orders yet.", es: "Ningún pedido por el momento.", ar: "لا يوجد طلب حتى الآن." },
  "commandes.facture_pdf": { fr: "Facture PDF", en: "PDF invoice", es: "Factura PDF", ar: "الفاتورة PDF" },
  "commandes.bon_commande_pdf": { fr: "Bon de commande PDF", en: "PDF purchase order", es: "Orden de compra PDF", ar: "أمر الشراء PDF" },
  "commandes.echec": { fr: "Échec", en: "Failed", es: "Fallido", ar: "فشل" },
  "commandes.responsable_oblig": { fr: "Le nom du responsable est obligatoire.", en: "The responsible party's name is required.", es: "El nombre del responsable es obligatorio.", ar: "اسم المسؤول إلزامي." },
  "commandes.pays_oblig": { fr: "Le pays est obligatoire.", en: "The country is required.", es: "El país es obligatorio.", ar: "البلد إلزامي." },
  "commandes.creation_echouee": { fr: "La création a échoué — vérifiez les valeurs saisies.", en: "Creation failed — check the values entered.", es: "La creación falló — verifique los valores ingresados.", ar: "فشل الإنشاء — تحقق من القيم المدخلة." },
  "commandes.version_linguistique": { fr: "Version linguistique", en: "Language version", es: "Versión lingüística", ar: "النسخة اللغوية" },
  "commandes.mode_impression": { fr: "Mode d'impression", en: "Printing mode", es: "Modo de impresión", ar: "وضع الطباعة" },
  "commandes.centralisee": { fr: "Centralisée", en: "Centralized", es: "Centralizada", ar: "مركزية" },
  "commandes.decentralisee": { fr: "Décentralisée", en: "Decentralized", es: "Descentralizada", ar: "لامركزية" },
  "commandes.placeholder_responsable": { fr: "Nom du responsable de la commande", en: "Name of the person responsible for the order", es: "Nombre del responsable del pedido", ar: "اسم المسؤول عن الطلب" },
  "commandes.creation_en_cours": { fr: "Création…", en: "Creating…", es: "Creando…", ar: "جارٍ الإنشاء…" },
  "commandes.creer": { fr: "Créer la commande", en: "Create order", es: "Crear el pedido", ar: "إنشاء الطلب" },

  // --- Paiements (pages/Paiements.tsx) ---
  "paiements.description": { fr: "Enregistrement et validation des paiements présentiel/virement.", en: "Recording and validation of in-person/transfer payments.", es: "Registro y validación de pagos presenciales/transferencias.", ar: "تسجيل والتحقق من المدفوعات الحضورية/التحويلات." },
  "paiements.aucune_commande": { fr: "Aucune commande à traiter.", en: "No orders to process.", es: "Ningún pedido por procesar.", ar: "لا يوجد طلب للمعالجة." },
  "paiements.selectionner": { fr: "Sélectionnez une commande à gauche.", en: "Select an order on the left.", es: "Seleccione un pedido a la izquierda.", ar: "اختر طلبًا على اليسار." },
  "paiements.enregistrement_echoue": { fr: "L'enregistrement a échoué.", en: "Saving failed.", es: "El registro falló.", ar: "فشل التسجيل." },
  "paiements.validation_echouee": { fr: "La validation a échoué.", en: "Validation failed.", es: "La validación falló.", ar: "فشل التحقق." },
  "paiements.montant_du": { fr: "Montant dû : {montant} XAF", en: "Amount due: {montant} XAF", es: "Monto adeudado: {montant} XAF", ar: "المبلغ المستحق: {montant} XAF" },
  "paiements.statut_commande": { fr: "Statut de la commande : {statut}", en: "Order status: {statut}", es: "Estado del pedido: {statut}", ar: "حالة الطلب: {statut}" },
  "paiements.enregistres": { fr: "Paiements enregistrés", en: "Recorded payments", es: "Pagos registrados", ar: "المدفوعات المسجلة" },
  "paiements.aucun": { fr: "Aucun paiement enregistré pour l'instant.", en: "No payment recorded yet.", es: "Ningún pago registrado por el momento.", ar: "لا يوجد دفع مسجل حتى الآن." },
  "paiements.valider": { fr: "Valider", en: "Confirm", es: "Confirmar", ar: "تأكيد" },
  "paiements.nouveau": { fr: "Enregistrer un nouveau paiement", en: "Record a new payment", es: "Registrar un nuevo pago", ar: "تسجيل دفعة جديدة" },
  "paiements.virement": { fr: "Virement", en: "Bank transfer", es: "Transferencia bancaria", ar: "تحويل مصرفي" },
  "paiements.especes": { fr: "Espèces", en: "Cash", es: "Efectivo", ar: "نقدًا" },
  "paiements.cheque": { fr: "Chèque", en: "Cheque", es: "Cheque", ar: "شيك" },
  "paiements.enregistrer": { fr: "Enregistrer", en: "Save", es: "Guardar", ar: "حفظ" },

  // --- Impression (pages/Impression.tsx) ---
  "impression.description": { fr: "Confirmer l'impression des commandes payées.", en: "Confirm printing of paid orders.", es: "Confirmar la impresión de los pedidos pagados.", ar: "تأكيد طباعة الطلبات المدفوعة." },
  "impression.commandes_payees": { fr: "Commandes payées", en: "Paid orders", es: "Pedidos pagados", ar: "الطلبات المدفوعة" },
  "impression.aucune_en_attente": { fr: "Aucune commande payée en attente d'impression.", en: "No paid order awaiting printing.", es: "Ningún pedido pagado pendiente de impresión.", ar: "لا يوجد طلب مدفوع في انتظار الطباعة." },
  "impression.document_echoue": { fr: "Le document n'a pas pu être généré — réessayez, ou signalez ce blocage.", en: "The document could not be generated — try again, or report this issue.", es: "El documento no pudo generarse — vuelva a intentarlo, o reporte este bloqueo.", ar: "تعذر إنشاء المستند — أعد المحاولة، أو أبلغ عن هذه المشكلة." },
  "impression.mode": { fr: "Mode : {mode}", en: "Mode: {mode}", es: "Modo: {mode}", ar: "الوضع: {mode}" },
  "impression.nb_disponibles": { fr: "{n} passeport(s) disponible(s)", en: "{n} passport(s) available", es: "{n} pasaporte(s) disponible(s)", ar: "{n} جواز سفر متاح" },
  "impression.nombre_a_afficher": { fr: "Nombre à afficher :", en: "Number to display:", es: "Número a mostrar:", ar: "العدد المراد عرضه:" },
  "impression.ouvrir_pdf": { fr: "Ouvrir le PDF", en: "Open PDF", es: "Abrir el PDF", ar: "فتح ملف PDF" },
  "impression.imprimez_puis_declarez": { fr: "Imprimez le document téléchargé ci-dessus, puis déclarez le lot réellement imprimé dans la section ci-dessous.", en: "Print the document downloaded above, then declare the actually printed batch in the section below.", es: "Imprima el documento descargado arriba, luego declare el lote realmente impreso en la sección de abajo.", ar: "اطبع المستند الذي تم تنزيله أعلاه، ثم أعلن عن الدفعة المطبوعة فعليًا في القسم أدناه." },
  "impression.autorisations_titre": { fr: "Autorisations d'impression décentralisée", en: "Decentralized printing authorizations", es: "Autorizaciones de impresión descentralizada", ar: "تراخيص الطباعة اللامركزية" },
  "impression.nouvelle_autorisation": { fr: "+ Nouvelle autorisation", en: "+ New authorization", es: "+ Nueva autorización", ar: "+ ترخيص جديد" },
  "impression.plage": { fr: "Plage {debut}–{fin} (gabarit v{version})", en: "Range {debut}–{fin} (template v{version})", es: "Rango {debut}–{fin} (plantilla v{version})", ar: "النطاق {debut}–{fin} (النموذج v{version})" },
  "impression.suspendre": { fr: "Suspendre", en: "Suspend", es: "Suspender", ar: "تعليق" },
  "impression.aucune_autorisation": { fr: "Aucune autorisation active", en: "No active authorization", es: "Ninguna autorización activa", ar: "لا يوجد ترخيص نشط" },
  "impression.creation_echouee": { fr: "La création a échoué.", en: "Creation failed.", es: "La creación falló.", ar: "فشل الإنشاء." },
  "impression.numero_debut": { fr: "Numéro début", en: "Start number", es: "Número inicial", ar: "الرقم الأول" },
  "impression.numero_fin": { fr: "Numéro fin", en: "End number", es: "Número final", ar: "الرقم الأخير" },
  "impression.version_gabarit": { fr: "Version gabarit", en: "Template version", es: "Versión de plantilla", ar: "إصدار النموذج" },
  "impression.declarer_lot_titre": { fr: "Déclarer un lot imprimé (impression décentralisée)", en: "Declare a printed batch (decentralized printing)", es: "Declarar un lote impreso (impresión descentralizada)", ar: "الإعلان عن دفعة مطبوعة (طباعة لامركزية)" },
  "impression.declarer_lot_intro": { fr: "À utiliser une fois le lot physiquement imprimé localement, dans la plage autorisée pour le pays. Rejeté en bloc si un numéro de la plage est manquant ou déjà imprimé.", en: "Use once the batch is physically printed locally, within the range authorized for the country. Rejected entirely if a number in the range is missing or already printed.", es: "Usar una vez que el lote esté físicamente impreso localmente, dentro del rango autorizado para el país. Rechazado en su totalidad si falta un número del rango o ya está impreso.", ar: "يُستخدم بعد طباعة الدفعة فعليًا محليًا، ضمن النطاق المصرَّح به للبلد. يُرفض بالكامل إذا كان أحد أرقام النطاق مفقودًا أو مطبوعًا بالفعل." },
  "impression.declarer": { fr: "Déclarer", en: "Declare", es: "Declarar", ar: "إعلان" },
  "impression.declare_succes": { fr: "{n} passeport(s) déclaré(s) imprimé(s) — passés au statut \"vierge\".", en: "{n} passport(s) declared printed — moved to \"blank\" status.", es: "{n} pasaporte(s) declarado(s) impreso(s) — pasado(s) al estado \\\"en blanco\\\".", ar: "تم الإعلان عن طباعة {n} جواز سفر — وتحويله إلى حالة \\\"فارغ\\\"." },
  "impression.declaration_echouee": { fr: "La déclaration a échoué.", en: "Declaration failed.", es: "La declaración falló.", ar: "فشل الإعلان." },

  // --- Statistiques (pages/Statistiques.tsx) ---
  "statistiques.erreur_chargement": { fr: "Impossible de charger le tableau de bord.", en: "Unable to load the dashboard.", es: "No se pudo cargar el panel de control.", ar: "تعذر تحميل لوحة التحكم." },
  "statistiques.chargement_tdb": { fr: "Chargement du tableau de bord…", en: "Loading dashboard…", es: "Cargando panel de control…", ar: "جارٍ تحميل لوحة التحكم…" },
  "statistiques.donnees_indisponibles": { fr: "Données indisponibles.", en: "Data unavailable.", es: "Datos no disponibles.", ar: "البيانات غير متوفرة." },
  "statistiques.titre": { fr: "Tableau de bord régional", en: "Regional dashboard", es: "Panel regional", ar: "اللوحة الإقليمية" },
  "statistiques.resume": { fr: "{pays} pays · {commandes} commandes · {montant} XAF encaissés", en: "{pays} countries · {commandes} orders · {montant} XAF collected", es: "{pays} países · {commandes} pedidos · {montant} XAF recaudados", ar: "{pays} بلد · {commandes} طلب · {montant} XAF محصَّلة" },
  "statistiques.entonnoir_titre": { fr: "Entonnoir global — par phase du pipeline", en: "Global funnel — by pipeline phase", es: "Embudo global — por fase del proceso", ar: "القمع الإجمالي — حسب مرحلة المسار" },
  "statistiques.par_pays_titre": { fr: "Par pays — commandes et passeports émis/contrôlés", en: "By country — orders and issued/checked passports", es: "Por país — pedidos y pasaportes emitidos/controlados", ar: "حسب البلد — الطلبات وجوازات السفر الصادرة/المراقَبة" },
  "statistiques.emis": { fr: "Émis", en: "Issued", es: "Emitidos", ar: "صادرة" },
  "statistiques.controles": { fr: "Contrôlés", en: "Checked", es: "Controlados", ar: "مراقَبة" },
  "statistiques.par_poste_titre": { fr: "Par poste de contrôle", en: "By control post", es: "Por puesto de control", ar: "حسب مركز المراقبة" },
  "statistiques.poste": { fr: "Poste", en: "Post", es: "Puesto", ar: "المركز" },
  "statistiques.total": { fr: "Total", en: "Total", es: "Total", ar: "المجموع" },
  "statistiques.valides": { fr: "Validés", en: "Passed", es: "Validados", ar: "مقبولة" },
  "statistiques.refuses": { fr: "Refusés", en: "Failed", es: "Rechazados", ar: "مرفوضة" },
  "statistiques.a_verifier": { fr: "À vérifier", en: "To review", es: "Por revisar", ar: "قيد المراجعة" },
  "statistiques.aucun_poste": { fr: "Aucun poste référencé pour l'instant.", en: "No post registered yet.", es: "Ningún puesto registrado por el momento.", ar: "لا يوجد مركز مسجَّل حتى الآن." },
  "statistiques.detail_titre": { fr: "Détail par pays et par année", en: "Detail by country and year", es: "Detalle por país y por año", ar: "التفاصيل حسب البلد والسنة" },
  "statistiques.detail_intro": { fr: "Commandes, paiements (par moyen), passeports (par statut) et contrôles (par résultat).", en: "Orders, payments (by method), passports (by status) and checks (by outcome).", es: "Pedidos, pagos (por método), pasaportes (por estado) y controles (por resultado).", ar: "الطلبات، المدفوعات (حسب الوسيلة)، جوازات السفر (حسب الحالة) والمراقبات (حسب النتيجة)." },
  "statistiques.section_echouee": { fr: "Cette section n'a pas pu être chargée — le reste du tableau de bord reste disponible.", en: "This section could not be loaded — the rest of the dashboard is still available.", es: "Esta sección no pudo cargarse — el resto del panel sigue disponible.", ar: "تعذر تحميل هذا القسم — بقية اللوحة لا تزال متاحة." },
  "statistiques.carte_titre": { fr: "Carte des mouvements — clusters de contrôle", en: "Movement map — control clusters", es: "Mapa de movimientos — clústeres de control", ar: "خريطة التنقلات — تجمعات المراقبة" },
  "statistiques.carte_intro": { fr: "Regroupement géospatial (PostGIS en production) des contrôles enregistrés. Taille du cercle proportionnelle au volume ; couleur selon la proportion de résultats validés.", en: "Geospatial clustering (PostGIS in production) of recorded checks. Circle size proportional to volume; color based on the share of passed results.", es: "Agrupación geoespacial (PostGIS en producción) de los controles registrados. Tamaño del círculo proporcional al volumen; color según la proporción de resultados validados.", ar: "تجميع جغرافي مكاني (PostGIS في الإنتاج) للمراقبات المسجَّلة. حجم الدائرة يتناسب مع الحجم؛ اللون حسب نسبة النتائج المقبولة." },
  "statistiques.aucun_controle_geo": { fr: "Aucun contrôle géolocalisé pour l'instant.", en: "No geolocated check yet.", es: "Ningún control geolocalizado por el momento.", ar: "لا توجد مراقبة محددة الموقع حتى الآن." },
  "statistiques.n_controles": { fr: "{n} contrôle(s)", en: "{n} check(s)", es: "{n} control(es)", ar: "{n} مراقبة" },
  "statistiques.tous_pays": { fr: "Tous les pays", en: "All countries", es: "Todos los países", ar: "جميع البلدان" },
  "statistiques.annee": { fr: "Année", en: "Year", es: "Año", ar: "السنة" },
  "statistiques.toutes_annees": { fr: "Toutes les années", en: "All years", es: "Todos los años", ar: "جميع السنوات" },
  "statistiques.toutes_f": { fr: "Toutes", en: "All", es: "Todas", ar: "الكل" },
  "statistiques.exporter": { fr: "Exporter", en: "Export", es: "Exportar", ar: "تصدير" },
  "statistiques.generation": { fr: "Génération…", en: "Generating…", es: "Generando…", ar: "جارٍ الإنشاء…" },
  "statistiques.exporter_excel": { fr: "Exporter en Excel", en: "Export to Excel", es: "Exportar a Excel", ar: "التصدير إلى Excel" },
  "statistiques.export_echoue": { fr: "L'export a échoué — réessayez.", en: "Export failed — try again.", es: "La exportación falló — vuelva a intentarlo.", ar: "فشل التصدير — أعد المحاولة." },
  "statistiques.export_emis": { fr: "Passeports émis", en: "Issued passports", es: "Pasaportes emitidos", ar: "جوازات السفر الصادرة" },
  "statistiques.export_controles": { fr: "Passeports vérifiés (contrôles)", en: "Checked passports (controls)", es: "Pasaportes verificados (controles)", ar: "جوازات السفر المتحقق منها (المراقبات)" },
  "statistiques.montant_commande": { fr: "Montant commandé", en: "Ordered amount", es: "Monto pedido", ar: "المبلغ المطلوب" },
  "statistiques.montant_encaisse": { fr: "Montant encaissé", en: "Collected amount", es: "Monto recaudado", ar: "المبلغ المحصَّل" },
  "statistiques.moyens_paiement": { fr: "Moyens de paiement", en: "Payment methods", es: "Medios de pago", ar: "وسائل الدفع" },
  "statistiques.vierge": { fr: "Vierge", en: "Blank", es: "En blanco", ar: "فارغ" },
  "statistiques.controle": { fr: "Contrôlé", en: "Checked", es: "Controlado", ar: "مراقَب" },
  "statistiques.verifs_validees": { fr: "Vérifs. validées", en: "Passed checks", es: "Verif. validadas", ar: "تحققات مقبولة" },
  "statistiques.refusees": { fr: "Refusées", en: "Failed", es: "Rechazadas", ar: "مرفوضة" },
  "statistiques.aucune_donnee": { fr: "Aucune donnée pour ce filtre.", en: "No data for this filter.", es: "Ningún dato para este filtro.", ar: "لا توجد بيانات لهذا الفلتر." },
  "statistiques.erreur_emissions": { fr: "Impossible de charger le détail des émissions.", en: "Unable to load issuance details.", es: "No se pudo cargar el detalle de las emisiones.", ar: "تعذر تحميل تفاصيل الإصدارات." },
  "statistiques.emissions_titre": { fr: "Détail des émissions — éleveurs, convoyeurs, troupeaux", en: "Issuance details — owners, conveyors, herds", es: "Detalle de emisiones — propietarios, transportistas, rebaños", ar: "تفاصيل الإصدارات — الملاك والناقلون والقطعان" },
  "statistiques.emissions_intro": { fr: "Identité (nom, N° CNI, téléphone) de l'éleveur et du convoyeur, composition du troupeau par espèce et vaccinations enregistrées, pour chaque passeport effectivement émis sur le terrain.", en: "Identity (name, ID No., phone) of the owner and conveyor, herd composition by species and recorded vaccinations, for each passport actually issued in the field.", es: "Identidad (nombre, cédula, teléfono) del propietario y del transportista, composición del rebaño por especie y vacunaciones registradas, para cada pasaporte efectivamente emitido en el campo.", ar: "هوية (الاسم، رقم بطاقة الهوية، الهاتف) المالك والناقل، وتركيبة القطيع حسب النوع والتلقيحات المسجَّلة، لكل جواز سفر صادر فعليًا في الميدان." },
  "statistiques.aucune_emission": { fr: "Aucune émission pour ce filtre.", en: "No issuance for this filter.", es: "Ninguna emisión para este filtro.", ar: "لا يوجد إصدار لهذا الفلتر." },
  "statistiques.tetes": { fr: "{n} tête(s)", en: "{n} head", es: "{n} cabeza(s)", ar: "{n} رأس" },
  "statistiques.cni": { fr: "CNI", en: "ID No.", es: "Cédula", ar: "بطاقة الهوية" },
  "statistiques.tel": { fr: "Tél.", en: "Tel.", es: "Tel.", ar: "هاتف" },
  "statistiques.non_renseigne": { fr: "Non renseigné.", en: "Not provided.", es: "No proporcionado.", ar: "غير مُدخل." },
  "statistiques.itineraire": { fr: "Itinéraire", en: "Route", es: "Itinerario", ar: "المسار" },
  "statistiques.historique_personne_intro": { fr: "Historique de tous les passeports où cette personne est apparue", en: "History of all passports this person has appeared on", es: "Historial de todos los pasaportes donde apareció esta persona", ar: "سجل جميع جوازات السفر التي ظهر فيها هذا الشخص" },
  "statistiques.aucun_voyage": { fr: "Aucun autre passeport trouvé pour cette personne.", en: "No other passport found for this person.", es: "No se encontró otro pasaporte para esta persona.", ar: "لم يُعثر على جواز سفر آخر لهذا الشخص." },
  "statistiques.controles_effectues": { fr: "Contrôles effectués", en: "Checks performed", es: "Controles efectuados", ar: "المراقبات المنجزة" },
  "statistiques.aucun_controle": { fr: "Aucun contrôle enregistré pour ce passeport.", en: "No check recorded for this passport.", es: "Ningún control registrado para este pasaporte.", ar: "لا توجد مراقبة مسجَّلة لهذا الجواز." },
  "commun.fermer": { fr: "Fermer", en: "Close", es: "Cerrar", ar: "إغلاق" },
  "statistiques.especes": { fr: "Espèces", en: "Species", es: "Especies", ar: "الأنواع" },
  "statistiques.detail_effectif": { fr: "{total} (mâles {males}, femelles jeunes {fj}, femelles adultes {fa})", en: "{total} (males {males}, young females {fj}, adult females {fa})", es: "{total} (machos {males}, hembras jóvenes {fj}, hembras adultas {fa})", ar: "{total} (ذكور {males}، إناث صغيرة {fj}، إناث بالغة {fa})" },
  "statistiques.validee": { fr: "validée", en: "confirmed", es: "validado", ar: "مصادَق عليه" },
  "statistiques.non_validee": { fr: "non validée", en: "not confirmed", es: "no validado", ar: "غير مصادَق عليه" },
};

/** Remplace {cle} dans une chaîne traduite par la valeur fournie —
 * interpolation minimale, pas de dépendance externe. */
export function interpoler(texte: string, valeurs: Record<string, string | number>): string {
  return texte.replace(/\{(\w+)\}/g, (correspondance, cle) => String(valeurs[cle] ?? correspondance));
}

interface ContexteI18n {
  langue: Langue;
  changerLangue: (l: Langue) => void;
  t: (cle: string, valeurs?: Record<string, string | number>) => string;
}

const Contexte = createContext<ContexteI18n | null>(null);

function lireLangue(): Langue {
  if (typeof localStorage === "undefined") return "fr";
  const valeur = localStorage.getItem(CLE_LANGUE);
  return valeur === "en" || valeur === "es" || valeur === "ar" ? valeur : "fr";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [langue, setLangue] = useState<Langue>(lireLangue);

  useEffect(() => {
    document.documentElement.lang = langue;
    // L'arabe s'affiche de droite à gauche — voir styles/rtl.css pour la
    // feuille de style qui inverse les propriétés physiques usuelles
    // (marges, alignements, positions) sous [dir="rtl"], sans modifier les
    // composants existants un par un.
    document.documentElement.dir = langue === "ar" ? "rtl" : "ltr";
  }, [langue]);

  const changerLangue = useCallback((l: Langue) => {
    localStorage.setItem(CLE_LANGUE, l);
    setLangue(l);
  }, []);

  const valeur = useMemo<ContexteI18n>(
    () => ({
      langue,
      changerLangue,
      t: (cle, valeurs) => {
        const brut = DICO[cle]?.[langue] ?? cle;
        return valeurs ? interpoler(brut, valeurs) : brut;
      },
    }),
    [langue, changerLangue]
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useI18n(): ContexteI18n {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useI18n doit être utilisé dans I18nProvider.");
  return contexte;
}
