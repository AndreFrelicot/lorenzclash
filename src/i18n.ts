export type Locale =
  | 'en'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt-BR'
  | 'ja'
  | 'ko'
  | 'zh-Hans'
  | 'th'
  | 'hi'
  | 'id'
  | 'ar'
  | 'ru'
  | 'it'
  | 'tr'
  | 'bn';

export interface LocaleOption {
  locale: Locale;
  flag: string;
  label: string;
  nativeName: string;
  short: string;
}

export interface Translation {
  appName: string;
  common: {
    close: string;
    reload: string;
    cancel: string;
    delete: string;
    download: string;
    share: string;
  };
  language: {
    buttonLabel: string;
    title: string;
    subtitle: string;
    close: string;
  };
  start: {
    title: string;
    quotes: [string, string];
    camera: string;
    music: string;
    enableCamera: string;
    startingCamera: string;
    cameraUnavailable: string;
    rotateCamera: string;
    fixAspect: string;
    help: string;
    enterChaos: string;
    privacyHtml: string;
    systemRequirements: string;
    photosensitivityHtml: string;
    headphonesHtml: string;
  };
  controls: {
    shapeLabels: [string, string, string];
    shapeBadges: [string, string, string];
    audioLabels: [string, string];
    followLabels: [string, string, string, string, string];
    trackFallback: string;
    trailOff: string;
    splitOn: string;
    splitOff: string;
    frameMargin: string;
    cameraOn: string;
    cameraOff: string;
    speedPad: string;
    snapshot: string;
    export: string;
    finishingCapture: string;
    autoOn: string;
    autoOff: string;
    help: string;
  };
  legend: {
    controlsTitle: string;
    exportClipsTitle: string;
    exportTitle: string;
    requirementsTitle: string;
    creditsTitle: string;
    previousPage: string;
    nextPage: string;
    gestureControls: string;
    credits: {
      line1: string;
      line2: string;
      date: string;
      privacyTitle: string;
      privacyLine1: string;
      privacyLine2: string;
    };
    items: {
      shapeName: string;
      shapeDesc: string;
      trailName: string;
      trailDesc: string;
      viewName: string;
      viewDesc: string;
      snapshotName: string;
      snapshotDesc: string;
      musicName: string;
      musicDesc: string;
      splitName: string;
      splitDesc: string;
      cameraName: string;
      cameraDesc: string;
      exportName: string;
      exportDesc: string;
      trackName: string;
      trackDesc: string;
      frameName: string;
      frameDesc: string;
      speedName: string;
      speedDesc: string;
      autoName: string;
      autoDesc: string;
      slowmoName: string;
      slowmoDesc: string;
      pinchName: string;
      pinchDesc: string;
      clipsName: string;
      clipsDesc: string;
      includeName: string;
      includeDesc: string;
      keepName: string;
      keepDesc: string;
      deleteName: string;
      deleteDesc: string;
      soundName: string;
      soundDesc: string;
      generateName: string;
      generateDesc: string;
      deviceLimitsName: string;
      deviceLimitsDesc: string;
      browserName: string;
      browserDesc: string;
      recommendedName: string;
      recommendedDesc: string;
      olderDevicesName: string;
      olderDevicesDesc: string;
    };
  };
  exportMenu: {
    title: string;
    empty: string;
    synced: string;
    syncedTitle: string;
    continuous: string;
    continuousTitle: string;
    includeSound: string;
    sound: string;
    exportDuration: (duration: string) => string;
    clearUnkeptLabel: (n: number) => string;
    clearUnkeptConfirm: (n: number) => string;
    generateVideo: string;
    generated: string;
    generating: string;
    failedRetry: string;
    dragToReorder: string;
    included: string;
    excluded: string;
    kept: string;
    keep: string;
    deleteClip: string;
    deleteClipConfirm: string;
  };
  unsupported: {
    messageHtml: string;
  };
}

const STORAGE_KEY = 'lorenz.locale';

export const LOCALE_OPTIONS: LocaleOption[] = [
  { locale: 'en', flag: '🇺🇸🇬🇧', label: 'English', nativeName: 'English', short: 'EN' },
  { locale: 'fr', flag: '🇫🇷', label: 'French', nativeName: 'Français', short: 'FR' },
  { locale: 'de', flag: '🇩🇪', label: 'German', nativeName: 'Deutsch', short: 'DE' },
  { locale: 'es', flag: '🇪🇸', label: 'Spanish', nativeName: 'Español', short: 'ES' },
  {
    locale: 'pt-BR',
    flag: '🇧🇷',
    label: 'Portuguese (Brazil)',
    nativeName: 'Português do Brasil',
    short: 'PT',
  },
  { locale: 'ja', flag: '🇯🇵', label: 'Japanese', nativeName: '日本語', short: 'JA' },
  { locale: 'ko', flag: '🇰🇷', label: 'Korean', nativeName: '한국어', short: 'KO' },
  {
    locale: 'zh-Hans',
    flag: '🇨🇳',
    label: 'Chinese (Simplified)',
    nativeName: '简体中文',
    short: 'ZH',
  },
  { locale: 'th', flag: '🇹🇭', label: 'Thai', nativeName: 'ไทย', short: 'TH' },
  { locale: 'hi', flag: '🇮🇳', label: 'Hindi', nativeName: 'हिन्दी', short: 'HI' },
  { locale: 'id', flag: '🇮🇩', label: 'Indonesian', nativeName: 'Bahasa Indonesia', short: 'ID' },
  { locale: 'ar', flag: '🇸🇦', label: 'Arabic', nativeName: 'العربية', short: 'AR' },
  { locale: 'ru', flag: '🇷🇺', label: 'Russian', nativeName: 'Русский', short: 'RU' },
  { locale: 'it', flag: '🇮🇹', label: 'Italian', nativeName: 'Italiano', short: 'IT' },
  { locale: 'tr', flag: '🇹🇷', label: 'Turkish', nativeName: 'Türkçe', short: 'TR' },
  { locale: 'bn', flag: '🇧🇩', label: 'Bengali', nativeName: 'বাংলা', short: 'BN' },
];

const en: Translation = {
  appName: 'Lorenz Clash',
  common: {
    close: 'Close',
    reload: 'Reload',
    cancel: 'Cancel',
    delete: 'Delete',
    download: 'Download',
    share: 'Share',
  },
  language: {
    buttonLabel: 'Change language',
    title: 'Language',
    subtitle: 'Choose the interface language.',
    close: 'Close language selector',
  },
  start: {
    title: 'Lorenz Clash',
    quotes: [
      '“Does the flap of a butterfly’s wings in Brazil set off a tornado in Texas?”',
      '“One must still have chaos in oneself to be able to give birth to a dancing star.”',
    ],
    camera: 'Camera',
    music: 'Music',
    enableCamera: 'Enable camera to preview',
    startingCamera: 'Starting camera…',
    cameraUnavailable: 'Camera unavailable — tap to retry',
    rotateCamera: 'Rotate camera',
    fixAspect: 'Fix stretch (aspect)',
    help: 'How it works',
    enterChaos: 'Enter chaos',
    privacyHtml:
      '<strong>100% on-device.</strong> Your camera, photos and videos never leave your device — there is no backend, nothing is uploaded.',
    systemRequirements: 'System requirements',
    photosensitivityHtml:
      '<strong>Photosensitivity warning.</strong> Contains flashing lights, strobing and rapid colour changes.',
    headphonesHtml: '<strong>Headphones recommended.</strong>',
  },
  controls: {
    shapeLabels: ['Plane', 'Cube', 'Sphere'],
    shapeBadges: ['', 'Cube', 'Sphere'],
    audioLabels: ['Music muted', 'Music'],
    followLabels: ['Free view', 'Follow A', 'Follow B', 'Trail A', 'Trail B'],
    trackFallback: 'Track',
    trailOff: 'Trail off',
    splitOn: 'Split on',
    splitOff: 'Split off',
    frameMargin: 'Frame margin',
    cameraOn: 'Camera on',
    cameraOff: 'Camera off',
    speedPad: 'Speed pad',
    snapshot: 'Snapshot 5s',
    export: 'Export',
    finishingCapture: 'Finishing capture…',
    autoOn: 'Auto on',
    autoOff: 'Auto off',
    help: 'Help',
  },
  legend: {
    controlsTitle: 'Controls',
    exportClipsTitle: 'Share & Export — Clips',
    exportTitle: 'Share & Export',
    requirementsTitle: 'System Requirements',
    creditsTitle: 'Credits',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    gestureControls: 'Gesture controls',
    credits: {
      line1: "Lorenz Clash — a WebGPU experience you're part of.",
      line2: 'Created by André Frélicot.',
      date: 'June 2026',
      privacyTitle: 'Privacy',
      privacyLine1:
        'Everything runs on your device. Your camera feed, photos and videos never leave it and are never uploaded — there is no backend.',
      privacyLine2:
        'Audience analytics only: anonymous visit counts, with no cookies, no IP tracking and no personal data.',
    },
    items: {
      shapeName: 'Shape',
      shapeDesc: 'Cycle the card shape: plane → cube → sphere.',
      trailName: 'Trail',
      trailDesc: 'Follow the trail of the curve A → B.',
      viewName: 'View',
      viewDesc: 'Switch the camera: free orbit → follow curve A → follow curve B.',
      snapshotName: 'Snapshot',
      snapshotDesc:
        'Record a 5-second clip of the live view. Background appearances are also captured automatically (the first 10 are kept, then auto-capture pauses — keep or delete clips to free slots and record more). Both collect in the export list.',
      musicName: 'Music',
      musicDesc: 'Toggle sound or muted — the music always drives the visuals.',
      splitName: 'Split',
      splitDesc: 'Curve A keeps the camera, curve B uses synthetic matter.',
      cameraName: 'Camera',
      cameraDesc: 'Turn the live camera on or off as the visual material.',
      exportName: 'Export',
      exportDesc:
        'Open Share & Export: preview clips, reorder, choose the sound, then make a video to download or share.',
      trackName: 'Track',
      trackDesc: 'Skip to the next music track.',
      frameName: 'Frame',
      frameDesc: 'Pop a fader to tighten or loosen the framing of the free orbit view.',
      speedName: 'Speed',
      speedDesc:
        'Pop an XY pad to set each curve’s speed. Double-click or double-tap to reset to defaults.',
      autoName: 'Auto',
      autoDesc: 'Automatic director — switches camera & shapes in time with the music.',
      slowmoName: 'Slow-mo',
      slowmoDesc:
        'Press and hold anywhere, then drag — pull down to slow time and tape-stop the music; release to spring back.',
      pinchName: 'Pinch out',
      pinchDesc:
        'Spread two fingers to zoom in — a peek that springs back when you let go. Desktop: scroll or trackpad-pinch.',
      clipsName: 'Clips',
      clipsDesc:
        'Snapshots and background appearances collect here. Drag to reorder, tap to preview. Background capture pauses once unkept clips fill up — keep or clear some to resume.',
      includeName: 'Include',
      includeDesc: 'Toggle whether a clip is part of the exported video.',
      keepName: 'Keep',
      keepDesc:
        'Star a clip to keep it — never auto-deleted, and it no longer counts against the background-capture limit. Manual snapshots are kept by default.',
      deleteName: 'Delete',
      deleteDesc:
        'Trash a single clip, or use “Clear unkept” to remove every clip that isn’t kept (starred). A quick confirm guards both.',
      soundName: 'Sound',
      soundDesc:
        'Include the music. Synced = each clip keeps its own moment; Continuous = one unbroken track.',
      generateName: 'Generate',
      generateDesc:
        'Render the included clips into one video, then Download it or Share via your device.',
      deviceLimitsName: 'Device limits',
      deviceLimitsDesc:
        'Export resolution and frame rate adapt to your device’s memory — fuller on a computer, more limited on phones and tablets, where clips may be softer or less smooth.',
      browserName: 'Browser',
      browserDesc:
        'Lorenz Clash requires WebGPU and a secure HTTPS connection. Safari exposes WebGPU on macOS Tahoe 26+, iOS/iPadOS 26+ and visionOS 26+.',
      recommendedName: 'Recommended',
      recommendedDesc:
        'Recent Chrome/Edge on desktop, recent Android flagship or performance-focused upper-midrange phone running Chrome on Android 12+, or Safari 26 on a supported Apple OS.',
      olderDevicesName: 'Older devices',
      olderDevicesDesc:
        'Safari 26 on macOS Sequoia/Sonoma does not expose WebGPU; use Chrome/Edge there. Android performance varies widely, especially with camera mode and video export.',
    },
  },
  exportMenu: {
    title: 'Share & Export',
    empty:
      'Let the background mode run, or tap Snapshot 5s — each clip appears here. Tap to preview, drag to reorder.',
    synced: 'Synced',
    syncedTitle: 'Each clip keeps the music that played during it',
    continuous: 'Continuous',
    continuousTitle: 'One unbroken track from the first clip (no cuts)',
    includeSound: 'Include sound',
    sound: 'Sound',
    exportDuration: (duration) => `Video duration: ${duration}`,
    clearUnkeptLabel: (n) => `Clear unkept (${n})`,
    clearUnkeptConfirm: (n) =>
      `Clear ${n} unkept clip${n > 1 ? 's' : ''}? Only kept (starred) clips stay.`,
    generateVideo: 'Generate Video',
    generated: 'Generated ✓',
    generating: 'Generating…',
    failedRetry: 'Export failed — retry',
    dragToReorder: 'Drag to reorder',
    included: 'Included in export — tap to exclude',
    excluded: 'Excluded — tap to include',
    kept: 'Kept — tap to allow auto-delete',
    keep: 'Tap to keep (never auto-deleted)',
    deleteClip: 'Delete this clip',
    deleteClipConfirm: 'Delete this clip?',
  },
  unsupported: {
    messageHtml:
      'WebGPU is not available on this browser.<br />Safari requires macOS Tahoe 26, iOS/iPadOS 26 or visionOS 26+. On macOS Sequoia/Sonoma, use recent Chrome/Edge.',
  },
};

export const messages: Record<Locale, Translation> = {
  en,
  fr: {
    ...en,
    common: {
      close: 'Fermer',
      reload: 'Recharger',
      cancel: 'Annuler',
      delete: 'Supprimer',
      download: 'Télécharger',
      share: 'Partager',
    },
    language: {
      buttonLabel: 'Changer de langue',
      title: 'Langue',
      subtitle: 'Choisissez la langue de l’interface.',
      close: 'Fermer le sélecteur de langue',
    },
    start: {
      ...en.start,
      quotes: [
        '« Le battement d’ailes d’un papillon au Brésil peut-il déclencher une tornade au Texas ? »',
        '« Il faut encore porter en soi un chaos pour pouvoir mettre au monde une étoile dansante. »',
      ],
      camera: 'Caméra',
      music: 'Musique',
      enableCamera: 'Activez la caméra pour prévisualiser',
      startingCamera: 'Démarrage de la caméra…',
      cameraUnavailable: 'Caméra indisponible — touchez pour réessayer',
      rotateCamera: 'Tourner la caméra',
      fixAspect: 'Corriger l’étirement',
      help: 'Comment ça marche',
      enterChaos: 'Entrer dans le chaos',
      privacyHtml:
        '<strong>100% sur l’appareil.</strong> Votre caméra, vos photos et vos vidéos ne quittent jamais votre appareil — il n’y a pas de backend, rien n’est téléversé.',
      systemRequirements: 'Configuration requise',
      photosensitivityHtml:
        '<strong>Avertissement photosensibilité.</strong> Contient des flashs, effets stroboscopiques et changements rapides de couleur.',
      headphonesHtml: '<strong>Casque recommandé.</strong>',
    },
    controls: {
      shapeLabels: ['Plan', 'Cube', 'Sphère'],
      shapeBadges: ['', 'Cube', 'Sphère'],
      audioLabels: ['Musique muette', 'Musique'],
      followLabels: ['Vue libre', 'Suivre A', 'Suivre B', 'Traînée A', 'Traînée B'],
      trackFallback: 'Morceau',
      trailOff: 'Traînée off',
      splitOn: 'Division activée',
      splitOff: 'Division désactivée',
      frameMargin: 'Cadrage',
      cameraOn: 'Caméra on',
      cameraOff: 'Caméra off',
      speedPad: 'Pad vitesse',
      snapshot: 'Capture 5s',
      export: 'Export',
      finishingCapture: 'Finalisation de la capture…',
      autoOn: 'Auto on',
      autoOff: 'Auto off',
      help: 'Aide',
    },
    legend: {
      ...en.legend,
      controlsTitle: 'Contrôles',
      exportClipsTitle: 'Partager & exporter — Clips',
      exportTitle: 'Partager & exporter',
      requirementsTitle: 'Configuration requise',
      creditsTitle: 'Crédits',
      previousPage: 'Page précédente',
      nextPage: 'Page suivante',
      gestureControls: 'Contrôles gestuels',
      credits: {
        line1: 'Lorenz Clash — une expérience WebGPU dont vous faites partie.',
        line2: 'Créé par André Frélicot.',
        date: 'Juin 2026',
        privacyTitle: 'Confidentialité',
        privacyLine1:
          'Tout fonctionne sur votre appareil. Le flux caméra, les photos et les vidéos ne le quittent jamais et ne sont jamais téléversés — il n’y a pas de backend.',
        privacyLine2:
          'Statistiques d’audience uniquement : comptage anonyme des visites, sans cookies, sans suivi IP et sans données personnelles.',
      },
      items: {
        ...en.legend.items,
        shapeName: 'Forme',
        shapeDesc: 'Change la forme de carte : plan → cube → sphère.',
        trailName: 'Traînée',
        trailDesc: 'Suit la traînée de la courbe A → B.',
        viewName: 'Vue',
        viewDesc: 'Change la caméra : orbite libre → suivre courbe A → suivre courbe B.',
        snapshotName: 'Capture',
        snapshotDesc:
          'Enregistre 5 secondes de la vue. Les apparitions de fond sont aussi capturées automatiquement (les 10 premières sont gardées, puis l’auto-capture se met en pause — gardez ou supprimez des clips pour libérer des places).',
        musicName: 'Musique',
        musicDesc: 'Active le son ou le mode muet — la musique pilote toujours les visuels.',
        splitName: 'Division',
        splitDesc: 'La courbe A garde la caméra, la courbe B utilise une matière synthétique.',
        cameraName: 'Caméra',
        cameraDesc: 'Active ou coupe la caméra comme matière visuelle.',
        exportName: 'Export',
        exportDesc:
          'Ouvre Partager & exporter : prévisualiser, réordonner, choisir le son, puis générer une vidéo.',
        trackName: 'Morceau',
        trackDesc: 'Passe au morceau suivant.',
        frameName: 'Cadrage',
        frameDesc: 'Ouvre un fader pour resserrer ou élargir le cadrage de la vue libre.',
        speedName: 'Vitesse',
        speedDesc:
          'Ouvre un pad XY pour régler la vitesse des courbes. Double-clic ou double-tap pour revenir aux défauts.',
        autoName: 'Auto',
        autoDesc: 'Réalisateur automatique — change caméra et formes en rythme avec la musique.',
        slowmoName: 'Ralenti',
        slowmoDesc:
          'Maintenez puis glissez — tirez vers le bas pour ralentir le temps et la musique ; relâchez pour revenir.',
        pinchName: 'Pincer',
        pinchDesc:
          'Écartez deux doigts pour zoomer — le zoom revient quand vous relâchez. Bureau : molette ou pincement trackpad.',
        clipsName: 'Clips',
        clipsDesc:
          'Les captures et apparitions automatiques arrivent ici. Glissez pour réordonner, touchez pour prévisualiser. L’auto-capture se met en pause quand les clips non gardés saturent la liste.',
        includeName: 'Inclure',
        includeDesc: 'Choisit si un clip fait partie de la vidéo exportée.',
        keepName: 'Garder',
        keepDesc:
          'Étoile un clip pour le garder — jamais supprimé automatiquement et hors limite d’auto-capture.',
        deleteName: 'Supprimer',
        deleteDesc:
          'Supprime un clip, ou “Vider non gardés” pour enlever tous les clips non étoilés.',
        soundName: 'Son',
        soundDesc:
          'Inclut la musique. Synchro = chaque clip garde son moment ; Continu = un morceau sans coupe.',
        generateName: 'Générer',
        generateDesc:
          'Rend les clips inclus en une seule vidéo, puis téléchargez-la ou partagez-la.',
        deviceLimitsName: 'Limites appareil',
        deviceLimitsDesc:
          'La résolution et la cadence d’export s’adaptent à la mémoire — plus généreuses sur ordinateur, plus limitées sur mobiles et tablettes.',
        browserName: 'Navigateur',
        browserDesc:
          'Lorenz Clash nécessite WebGPU et une connexion HTTPS sécurisée. Safari expose WebGPU sur macOS Tahoe 26+, iOS/iPadOS 26+ et visionOS 26+.',
        recommendedName: 'Recommandé',
        recommendedDesc:
          'Chrome/Edge récent sur desktop, Android flagship récent ou milieu de gamme performant avec Chrome sur Android 12+, ou Safari 26 sur un OS Apple compatible.',
        olderDevicesName: 'Anciens appareils',
        olderDevicesDesc:
          'Safari 26 sous macOS Sequoia/Sonoma n’expose pas WebGPU ; utilisez Chrome/Edge sur ces OS. Les performances Android varient beaucoup, surtout avec la caméra et l’export vidéo.',
      },
    },
    exportMenu: {
      ...en.exportMenu,
      title: 'Partager & exporter',
      empty:
        'Laissez tourner le mode fond, ou touchez Capture 5s — chaque clip apparaît ici. Touchez pour prévisualiser, glissez pour réordonner.',
      synced: 'Synchro',
      syncedTitle: 'Chaque clip garde la musique jouée pendant lui',
      continuous: 'Continu',
      continuousTitle: 'Un morceau sans coupure depuis le premier clip',
      includeSound: 'Inclure le son',
      sound: 'Son',
      exportDuration: (duration) => `Durée vidéo : ${duration}`,
      clearUnkeptLabel: (n) => `Vider non gardés (${n})`,
      clearUnkeptConfirm: (n) =>
        `Supprimer ${n} clip${n > 1 ? 's' : ''} non gardé${n > 1 ? 's' : ''} ? Seuls les clips étoilés restent.`,
      generateVideo: 'Générer la vidéo',
      generated: 'Généré ✓',
      generating: 'Génération…',
      failedRetry: 'Export échoué — réessayer',
      dragToReorder: 'Glisser pour réordonner',
      included: 'Inclus dans l’export — toucher pour exclure',
      excluded: 'Exclu — toucher pour inclure',
      kept: 'Gardé — toucher pour autoriser la suppression auto',
      keep: 'Toucher pour garder (jamais supprimé automatiquement)',
      deleteClip: 'Supprimer ce clip',
      deleteClipConfirm: 'Supprimer ce clip ?',
    },
    unsupported: {
      messageHtml:
        'WebGPU n’est pas disponible dans ce navigateur.<br />Safari nécessite macOS Tahoe 26, iOS/iPadOS 26 ou visionOS 26+. Sur macOS Sequoia/Sonoma, utilisez Chrome/Edge récent.',
    },
  },
  de: {
    ...en,
    common: {
      close: 'Schließen',
      reload: 'Neu laden',
      cancel: 'Abbrechen',
      delete: 'Löschen',
      download: 'Download',
      share: 'Teilen',
    },
    language: {
      buttonLabel: 'Sprache ändern',
      title: 'Sprache',
      subtitle: 'Wähle die Sprache der Oberfläche.',
      close: 'Sprachauswahl schließen',
    },
    start: {
      ...en.start,
      quotes: [
        '„Kann der Flügelschlag eines Schmetterlings in Brasilien einen Tornado in Texas auslösen?“',
        '„Man muss noch Chaos in sich haben, um einen tanzenden Stern gebären zu können.“',
      ],
      camera: 'Kamera',
      music: 'Musik',
      enableCamera: 'Kamera für Vorschau aktivieren',
      startingCamera: 'Kamera startet…',
      cameraUnavailable: 'Kamera nicht verfügbar — tippen zum Wiederholen',
      rotateCamera: 'Kamera drehen',
      fixAspect: 'Streckung korrigieren',
      help: 'So funktioniert es',
      enterChaos: 'Chaos starten',
      privacyHtml:
        '<strong>100% auf dem Gerät.</strong> Kamera, Fotos und Videos verlassen dein Gerät nie — kein Backend, kein Upload.',
      systemRequirements: 'Systemanforderungen',
      photosensitivityHtml:
        '<strong>Hinweis zu Photosensibilität.</strong> Enthält blinkende Lichter, Stroboskop-Effekte und schnelle Farbwechsel.',
      headphonesHtml: '<strong>Kopfhörer empfohlen.</strong>',
    },
    controls: {
      shapeLabels: ['Ebene', 'Würfel', 'Kugel'],
      shapeBadges: ['', 'Würfel', 'Kugel'],
      audioLabels: ['Musik stumm', 'Musik'],
      followLabels: ['Freie Ansicht', 'Folge A', 'Folge B', 'Spur A', 'Spur B'],
      trackFallback: 'Track',
      trailOff: 'Spur aus',
      splitOn: 'Teilung an',
      splitOff: 'Teilung aus',
      frameMargin: 'Ausschnitt',
      cameraOn: 'Kamera an',
      cameraOff: 'Kamera aus',
      speedPad: 'Tempo-Pad',
      snapshot: 'Snapshot 5s',
      export: 'Export',
      finishingCapture: 'Aufnahme wird abgeschlossen…',
      autoOn: 'Auto an',
      autoOff: 'Auto aus',
      help: 'Hilfe',
    },
    legend: makeTranslatedLegend('de'),
    exportMenu: makeTranslatedExport('de'),
    unsupported: {
      messageHtml:
        'WebGPU ist in diesem Browser nicht verfügbar.<br />Safari benötigt macOS Tahoe 26, iOS/iPadOS 26 oder visionOS 26+. Auf macOS Sequoia/Sonoma nutze aktuelles Chrome/Edge.',
    },
  },
  es: {
    ...en,
    common: {
      close: 'Cerrar',
      reload: 'Recargar',
      cancel: 'Cancelar',
      delete: 'Eliminar',
      download: 'Descargar',
      share: 'Compartir',
    },
    language: {
      buttonLabel: 'Cambiar idioma',
      title: 'Idioma',
      subtitle: 'Elige el idioma de la interfaz.',
      close: 'Cerrar selector de idioma',
    },
    start: {
      ...en.start,
      quotes: [
        '“¿El aleteo de una mariposa en Brasil puede provocar un tornado en Texas?”',
        '“Hay que llevar todavía caos dentro de sí para poder dar a luz una estrella danzante.”',
      ],
      camera: 'Cámara',
      music: 'Música',
      enableCamera: 'Activa la cámara para previsualizar',
      startingCamera: 'Iniciando cámara…',
      cameraUnavailable: 'Cámara no disponible — toca para reintentar',
      rotateCamera: 'Girar cámara',
      fixAspect: 'Corregir estiramiento',
      help: 'Cómo funciona',
      enterChaos: 'Entrar al caos',
      privacyHtml:
        '<strong>100% en tu dispositivo.</strong> Tu cámara, fotos y videos nunca salen del dispositivo — no hay backend ni subidas.',
      systemRequirements: 'Requisitos del sistema',
      photosensitivityHtml:
        '<strong>Aviso de fotosensibilidad.</strong> Contiene luces intermitentes, estrobos y cambios rápidos de color.',
      headphonesHtml: '<strong>Se recomiendan auriculares.</strong>',
    },
    controls: {
      shapeLabels: ['Plano', 'Cubo', 'Esfera'],
      shapeBadges: ['', 'Cubo', 'Esfera'],
      audioLabels: ['Música silenciada', 'Música'],
      followLabels: ['Vista libre', 'Seguir A', 'Seguir B', 'Estela A', 'Estela B'],
      trackFallback: 'Pista',
      trailOff: 'Estela off',
      splitOn: 'División activada',
      splitOff: 'División desactivada',
      frameMargin: 'Encuadre',
      cameraOn: 'Cámara on',
      cameraOff: 'Cámara off',
      speedPad: 'Pad velocidad',
      snapshot: 'Captura 5s',
      export: 'Exportar',
      finishingCapture: 'Finalizando captura…',
      autoOn: 'Auto on',
      autoOff: 'Auto off',
      help: 'Ayuda',
    },
    legend: makeTranslatedLegend('es'),
    exportMenu: makeTranslatedExport('es'),
    unsupported: {
      messageHtml:
        'WebGPU no está disponible en este navegador.<br />Safari requiere macOS Tahoe 26, iOS/iPadOS 26 o visionOS 26+. En macOS Sequoia/Sonoma, usa Chrome/Edge reciente.',
    },
  },
  'pt-BR': {
    ...en,
    common: {
      close: 'Fechar',
      reload: 'Recarregar',
      cancel: 'Cancelar',
      delete: 'Excluir',
      download: 'Baixar',
      share: 'Compartilhar',
    },
    language: {
      buttonLabel: 'Alterar idioma',
      title: 'Idioma',
      subtitle: 'Escolha o idioma da interface.',
      close: 'Fechar seletor de idioma',
    },
    start: {
      ...en.start,
      quotes: [
        '“O bater de asas de uma borboleta no Brasil pode provocar um tornado no Texas?”',
        '“É preciso ainda ter caos dentro de si para dar à luz uma estrela dançante.”',
      ],
      camera: 'Câmera',
      music: 'Música',
      enableCamera: 'Ative a câmera para pré-visualizar',
      startingCamera: 'Iniciando câmera…',
      cameraUnavailable: 'Câmera indisponível — toque para tentar de novo',
      rotateCamera: 'Girar câmera',
      fixAspect: 'Corrigir esticamento',
      help: 'Como funciona',
      enterChaos: 'Entrar no caos',
      privacyHtml:
        '<strong>100% no dispositivo.</strong> Sua câmera, fotos e vídeos nunca saem do dispositivo — não há backend, nada é enviado.',
      systemRequirements: 'Requisitos do sistema',
      photosensitivityHtml:
        '<strong>Aviso de fotossensibilidade.</strong> Contém luzes piscando, estrobos e mudanças rápidas de cor.',
      headphonesHtml: '<strong>Fones recomendados.</strong>',
    },
    controls: {
      shapeLabels: ['Plano', 'Cubo', 'Esfera'],
      shapeBadges: ['', 'Cubo', 'Esfera'],
      audioLabels: ['Música muda', 'Música'],
      followLabels: ['Vista livre', 'Seguir A', 'Seguir B', 'Rastro A', 'Rastro B'],
      trackFallback: 'Faixa',
      trailOff: 'Rastro off',
      splitOn: 'Divisão ativada',
      splitOff: 'Divisão desativada',
      frameMargin: 'Enquadrar',
      cameraOn: 'Câmera on',
      cameraOff: 'Câmera off',
      speedPad: 'Pad velocidade',
      snapshot: 'Captura 5s',
      export: 'Exportar',
      finishingCapture: 'Finalizando captura…',
      autoOn: 'Auto on',
      autoOff: 'Auto off',
      help: 'Ajuda',
    },
    legend: makeTranslatedLegend('pt-BR'),
    exportMenu: makeTranslatedExport('pt-BR'),
    unsupported: {
      messageHtml:
        'WebGPU não está disponível neste navegador.<br />O Safari requer macOS Tahoe 26, iOS/iPadOS 26 ou visionOS 26+. No macOS Sequoia/Sonoma, use Chrome/Edge recente.',
    },
  },
  ja: {
    ...en,
    common: {
      close: '閉じる',
      reload: '再読み込み',
      cancel: 'キャンセル',
      delete: '削除',
      download: 'ダウンロード',
      share: '共有',
    },
    language: {
      buttonLabel: '言語を変更',
      title: '言語',
      subtitle: 'インターフェースの言語を選択します。',
      close: '言語セレクターを閉じる',
    },
    start: {
      ...en.start,
      quotes: [
        '「ブラジルの蝶の羽ばたきは、テキサスの竜巻を引き起こすのか？」',
        '「踊る星を生み出すには、なお自らの内に混沌を持たねばならない。」',
      ],
      camera: 'カメラ',
      music: '音楽',
      enableCamera: 'プレビューするにはカメラを有効にしてください',
      startingCamera: 'カメラを起動中…',
      cameraUnavailable: 'カメラを使用できません — タップして再試行',
      rotateCamera: 'カメラを回転',
      fixAspect: '伸びを補正',
      help: '使い方',
      enterChaos: 'カオスへ',
      privacyHtml:
        '<strong>100% 端末内処理。</strong> カメラ、写真、動画は端末から出ません — バックエンドもアップロードもありません。',
      systemRequirements: '動作環境',
      photosensitivityHtml:
        '<strong>光過敏への注意。</strong> 点滅、ストロボ、高速な色変化を含みます。',
      headphonesHtml: '<strong>ヘッドホン推奨。</strong>',
    },
    controls: {
      shapeLabels: ['平面', 'キューブ', '球'],
      shapeBadges: ['', 'キューブ', '球'],
      audioLabels: ['音楽ミュート', '音楽'],
      followLabels: ['自由視点', 'Aを追跡', 'Bを追跡', '軌跡A', '軌跡B'],
      trackFallback: '曲',
      trailOff: '軌跡オフ',
      splitOn: '分割オン',
      splitOff: '分割オフ',
      frameMargin: 'フレーム',
      cameraOn: 'カメラオン',
      cameraOff: 'カメラオフ',
      speedPad: '速度パッド',
      snapshot: '5秒録画',
      export: '書き出し',
      finishingCapture: '録画を完了中…',
      autoOn: '自動オン',
      autoOff: '自動オフ',
      help: 'ヘルプ',
    },
    legend: makeTranslatedLegend('ja'),
    exportMenu: makeTranslatedExport('ja'),
    unsupported: {
      messageHtml:
        'このブラウザでは WebGPU を利用できません。<br />Safari には macOS Tahoe 26、iOS/iPadOS 26、または visionOS 26 以降が必要です。macOS Sequoia/Sonoma では最新の Chrome/Edge を使ってください。',
    },
  },
  ko: {
    ...en,
    common: {
      close: '닫기',
      reload: '새로고침',
      cancel: '취소',
      delete: '삭제',
      download: '다운로드',
      share: '공유',
    },
    language: {
      buttonLabel: '언어 변경',
      title: '언어',
      subtitle: '인터페이스 언어를 선택하세요.',
      close: '언어 선택 닫기',
    },
    start: {
      ...en.start,
      quotes: [
        '“브라질에서 나비가 날갯짓하면 텍사스에 토네이도가 일어날 수 있을까?”',
        '“춤추는 별을 낳으려면 아직 자기 안에 카오스를 품고 있어야 한다.”',
      ],
      camera: '카메라',
      music: '음악',
      enableCamera: '미리 보려면 카메라를 켜세요',
      startingCamera: '카메라 시작 중…',
      cameraUnavailable: '카메라를 사용할 수 없습니다 — 탭해서 다시 시도',
      rotateCamera: '카메라 회전',
      fixAspect: '늘어남 보정',
      help: '사용 방법',
      enterChaos: '카오스로',
      privacyHtml:
        '<strong>100% 기기 내 처리.</strong> 카메라, 사진, 영상은 기기를 떠나지 않습니다 — 백엔드도 업로드도 없습니다.',
      systemRequirements: '시스템 요구 사항',
      photosensitivityHtml:
        '<strong>광과민성 경고.</strong> 번쩍임, 스트로브, 빠른 색상 변화를 포함합니다.',
      headphonesHtml: '<strong>헤드폰 권장.</strong>',
    },
    controls: {
      shapeLabels: ['평면', '큐브', '구'],
      shapeBadges: ['', '큐브', '구'],
      audioLabels: ['음악 음소거', '음악'],
      followLabels: ['자유 시점', 'A 추적', 'B 추적', '잔상 A', '잔상 B'],
      trackFallback: '트랙',
      trailOff: '잔상 끔',
      splitOn: '분할 켬',
      splitOff: '분할 끔',
      frameMargin: '프레임',
      cameraOn: '카메라 켬',
      cameraOff: '카메라 끔',
      speedPad: '속도 패드',
      snapshot: '5초 캡처',
      export: '내보내기',
      finishingCapture: '캡처 마무리 중…',
      autoOn: '자동 켬',
      autoOff: '자동 끔',
      help: '도움말',
    },
    legend: makeTranslatedLegend('ko'),
    exportMenu: makeTranslatedExport('ko'),
    unsupported: {
      messageHtml:
        '이 브라우저에서는 WebGPU를 사용할 수 없습니다.<br />Safari는 macOS Tahoe 26, iOS/iPadOS 26 또는 visionOS 26 이상이 필요합니다. macOS Sequoia/Sonoma에서는 최신 Chrome/Edge를 사용하세요.',
    },
  },
  'zh-Hans': {
    ...en,
    common: {
      close: '关闭',
      reload: '重新加载',
      cancel: '取消',
      delete: '删除',
      download: '下载',
      share: '分享',
    },
    language: {
      buttonLabel: '切换语言',
      title: '语言',
      subtitle: '选择界面语言。',
      close: '关闭语言选择器',
    },
    start: {
      ...en.start,
      quotes: [
        '“巴西一只蝴蝶扇动翅膀，会在德克萨斯引发龙卷风吗？”',
        '“人必须心中仍有混沌，才能诞生一颗舞动的星。”',
      ],
      camera: '相机',
      music: '音乐',
      enableCamera: '启用相机以预览',
      startingCamera: '正在启动相机…',
      cameraUnavailable: '相机不可用 — 轻点重试',
      rotateCamera: '旋转相机',
      fixAspect: '修正拉伸',
      help: '使用说明',
      enterChaos: '进入混沌',
      privacyHtml:
        '<strong>100% 本机处理。</strong> 你的相机、照片和视频不会离开设备 — 没有后端，也不会上传。',
      systemRequirements: '系统要求',
      photosensitivityHtml: '<strong>光敏警告。</strong> 包含闪光、频闪和快速颜色变化。',
      headphonesHtml: '<strong>建议使用耳机。</strong>',
    },
    controls: {
      shapeLabels: ['平面', '立方体', '球体'],
      shapeBadges: ['', '立方体', '球体'],
      audioLabels: ['音乐静音', '音乐'],
      followLabels: ['自由视角', '跟随 A', '跟随 B', '轨迹 A', '轨迹 B'],
      trackFallback: '曲目',
      trailOff: '轨迹关',
      splitOn: '分屏开',
      splitOff: '分屏关',
      frameMargin: '取景',
      cameraOn: '相机开',
      cameraOff: '相机关',
      speedPad: '速度板',
      snapshot: '录制 5秒',
      export: '导出',
      finishingCapture: '正在完成录制…',
      autoOn: '自动开',
      autoOff: '自动关',
      help: '帮助',
    },
    legend: makeTranslatedLegend('zh-Hans'),
    exportMenu: makeTranslatedExport('zh-Hans'),
    unsupported: {
      messageHtml:
        '此浏览器不支持 WebGPU。<br />Safari 需要 macOS Tahoe 26、iOS/iPadOS 26 或 visionOS 26+。在 macOS Sequoia/Sonoma 上，请使用新版 Chrome/Edge。',
    },
  },
  th: {
    ...en,
    common: {
      close: 'ปิด',
      reload: 'โหลดใหม่',
      cancel: 'ยกเลิก',
      delete: 'ลบ',
      download: 'ดาวน์โหลด',
      share: 'แชร์',
    },
    language: {
      buttonLabel: 'เปลี่ยนภาษา',
      title: 'ภาษา',
      subtitle: 'เลือกภาษาของอินเทอร์เฟซ',
      close: 'ปิดตัวเลือกภาษา',
    },
    start: {
      ...en.start,
      quotes: [
        '“การกระพือปีกของผีเสื้อในบราซิล จะทำให้เกิดทอร์นาโดในเท็กซัสได้ไหม?”',
        '“เรายังต้องมีความเคออสอยู่ในตัวเอง จึงจะให้กำเนิดดาวที่เต้นรำได้”',
      ],
      camera: 'กล้อง',
      music: 'เพลง',
      enableCamera: 'เปิดกล้องเพื่อดูตัวอย่าง',
      startingCamera: 'กำลังเริ่มกล้อง…',
      cameraUnavailable: 'ใช้กล้องไม่ได้ — แตะเพื่อลองใหม่',
      rotateCamera: 'หมุนกล้อง',
      fixAspect: 'แก้ภาพยืด',
      help: 'วิธีใช้งาน',
      enterChaos: 'เข้าสู่เคออส',
      privacyHtml:
        '<strong>ประมวลผลบนอุปกรณ์ 100%.</strong> กล้อง รูปภาพ และวิดีโอของคุณไม่ออกจากอุปกรณ์ — ไม่มี backend และไม่มีการอัปโหลด',
      systemRequirements: 'ความต้องการของระบบ',
      photosensitivityHtml:
        '<strong>คำเตือนเรื่องแสง.</strong> มีแสงกะพริบ เอฟเฟกต์ strobe และการเปลี่ยนสีอย่างรวดเร็ว',
      headphonesHtml: '<strong>แนะนำให้ใช้หูฟัง.</strong>',
    },
    controls: {
      shapeLabels: ['ระนาบ', 'ลูกบาศก์', 'ทรงกลม'],
      shapeBadges: ['', 'ลูกบาศก์', 'ทรงกลม'],
      audioLabels: ['ปิดเสียงเพลง', 'เพลง'],
      followLabels: ['มุมมองอิสระ', 'ตาม A', 'ตาม B', 'ร่องรอย A', 'ร่องรอย B'],
      trackFallback: 'เพลง',
      trailOff: 'ปิดร่องรอย',
      splitOn: 'แบ่ง เปิด',
      splitOff: 'แบ่ง ปิด',
      frameMargin: 'เฟรม',
      cameraOn: 'กล้องเปิด',
      cameraOff: 'กล้องปิด',
      speedPad: 'แผงความเร็ว',
      snapshot: 'บันทึก 5วิ',
      export: 'ส่งออก',
      finishingCapture: 'กำลังจบการบันทึก…',
      autoOn: 'ออโต้เปิด',
      autoOff: 'ออโต้ปิด',
      help: 'ช่วยเหลือ',
    },
    legend: makeTranslatedLegend('th'),
    exportMenu: makeTranslatedExport('th'),
    unsupported: {
      messageHtml:
        'เบราว์เซอร์นี้ไม่รองรับ WebGPU<br />Safari ต้องใช้ macOS Tahoe 26, iOS/iPadOS 26 หรือ visionOS 26+ บน macOS Sequoia/Sonoma ให้ใช้ Chrome/Edge รุ่นใหม่',
    },
  },
  hi: {
    ...en,
    common: {
      close: 'बंद करें',
      reload: 'रीलोड',
      cancel: 'रद्द करें',
      delete: 'हटाएँ',
      download: 'डाउनलोड',
      share: 'शेयर',
    },
    language: {
      buttonLabel: 'भाषा बदलें',
      title: 'भाषा',
      subtitle: 'इंटरफ़ेस की भाषा चुनें।',
      close: 'भाषा चयन बंद करें',
    },
    start: {
      ...en.start,
      quotes: [
        '“क्या ब्राज़ील में तितली के पंख फड़फड़ाने से टेक्सास में बवंडर उठ सकता है?”',
        '“एक नाचते सितारे को जन्म देने के लिए अपने भीतर अभी भी कैओस होना चाहिए।”',
      ],
      camera: 'कैमरा',
      music: 'संगीत',
      enableCamera: 'पूर्वावलोकन के लिए कैमरा चालू करें',
      startingCamera: 'कैमरा शुरू हो रहा है…',
      cameraUnavailable: 'कैमरा उपलब्ध नहीं — फिर कोशिश करने के लिए टैप करें',
      rotateCamera: 'कैमरा घुमाएँ',
      fixAspect: 'खींचाव ठीक करें',
      help: 'कैसे काम करता है',
      enterChaos: 'कैओस शुरू करें',
      privacyHtml:
        '<strong>100% डिवाइस पर।</strong> आपका कैमरा, फ़ोटो और वीडियो डिवाइस से बाहर नहीं जाते — कोई सर्वर-पक्ष नहीं, कुछ अपलोड नहीं होता।',
      systemRequirements: 'सिस्टम आवश्यकताएँ',
      photosensitivityHtml:
        '<strong>प्रकाश-संवेदनशीलता चेतावनी।</strong> इसमें चमकती रोशनी और तेज़ रंग बदलाव हैं।',
      headphonesHtml: '<strong>हेडफ़ोन सुझाए जाते हैं।</strong>',
    },
    controls: {
      shapeLabels: ['समतल', 'घन', 'गोलक'],
      shapeBadges: ['', 'घन', 'गोलक'],
      audioLabels: ['संगीत मौन', 'संगीत'],
      followLabels: ['मुक्त दृश्य', 'A का अनुसरण', 'B का अनुसरण', 'पथरेखा A', 'पथरेखा B'],
      trackFallback: 'ट्रैक',
      trailOff: 'पथरेखा बंद',
      splitOn: 'विभाजन चालू',
      splitOff: 'विभाजन बंद',
      frameMargin: 'फ़्रेम',
      cameraOn: 'कैमरा चालू',
      cameraOff: 'कैमरा बंद',
      speedPad: 'गति पैड',
      snapshot: '5 सेकंड रिकॉर्ड',
      export: 'निर्यात',
      finishingCapture: 'रिकॉर्डिंग पूरी हो रही है…',
      autoOn: 'स्वचालित चालू',
      autoOff: 'स्वचालित बंद',
      help: 'मदद',
    },
    legend: makeTranslatedLegend('hi'),
    exportMenu: makeTranslatedExport('hi'),
    unsupported: {
      messageHtml:
        'इस ब्राउज़र में WebGPU उपलब्ध नहीं है।<br />Safari के लिए macOS Tahoe 26, iOS/iPadOS 26 या visionOS 26+ चाहिए। macOS Sequoia/Sonoma पर नया Chrome/Edge उपयोग करें।',
    },
  },
  id: {
    ...en,
    common: {
      close: 'Tutup',
      reload: 'Muat ulang',
      cancel: 'Batal',
      delete: 'Hapus',
      download: 'Unduh',
      share: 'Bagikan',
    },
    language: {
      buttonLabel: 'Ganti bahasa',
      title: 'Bahasa',
      subtitle: 'Pilih bahasa antarmuka.',
      close: 'Tutup pemilih bahasa',
    },
    start: {
      ...en.start,
      quotes: [
        '“Apakah kepakan sayap kupu-kupu di Brasil dapat memicu tornado di Texas?”',
        '“Seseorang masih harus memiliki kekacauan dalam dirinya untuk melahirkan bintang yang menari.”',
      ],
      camera: 'Kamera',
      music: 'Musik',
      enableCamera: 'Aktifkan kamera untuk pratinjau',
      startingCamera: 'Memulai kamera…',
      cameraUnavailable: 'Kamera tidak tersedia — ketuk untuk mencoba lagi',
      rotateCamera: 'Putar kamera',
      fixAspect: 'Perbaiki regangan',
      help: 'Cara kerja',
      enterChaos: 'Masuki chaos',
      privacyHtml:
        '<strong>100% di perangkat.</strong> Kamera, foto, dan video Anda tidak pernah keluar dari perangkat — tidak ada backend, tidak ada yang diunggah.',
      systemRequirements: 'Kebutuhan sistem',
      photosensitivityHtml:
        '<strong>Peringatan fotosensitivitas.</strong> Berisi lampu berkedip, strobo, dan perubahan warna cepat.',
      headphonesHtml: '<strong>Headphone disarankan.</strong>',
    },
    controls: {
      shapeLabels: ['Bidang', 'Kubus', 'Bola'],
      shapeBadges: ['', 'Kubus', 'Bola'],
      audioLabels: ['Musik senyap', 'Musik'],
      followLabels: ['Tampilan bebas', 'Ikuti A', 'Ikuti B', 'Jejak A', 'Jejak B'],
      trackFallback: 'Track',
      trailOff: 'Jejak mati',
      splitOn: 'Pisah aktif',
      splitOff: 'Pisah mati',
      frameMargin: 'Bingkai',
      cameraOn: 'Kamera aktif',
      cameraOff: 'Kamera mati',
      speedPad: 'Pad kecepatan',
      snapshot: 'Snapshot 5d',
      export: 'Ekspor',
      finishingCapture: 'Menyelesaikan tangkapan…',
      autoOn: 'Auto aktif',
      autoOff: 'Auto mati',
      help: 'Bantuan',
    },
    legend: makeTranslatedLegend('id'),
    exportMenu: makeTranslatedExport('id'),
    unsupported: {
      messageHtml:
        'WebGPU tidak tersedia di browser ini.<br />Safari memerlukan macOS Tahoe 26, iOS/iPadOS 26, atau visionOS 26+. Di macOS Sequoia/Sonoma, gunakan Chrome/Edge terbaru.',
    },
  },
  ar: {
    ...en,
    common: {
      close: 'إغلاق',
      reload: 'إعادة التحميل',
      cancel: 'إلغاء',
      delete: 'حذف',
      download: 'تنزيل',
      share: 'مشاركة',
    },
    language: {
      buttonLabel: 'تغيير اللغة',
      title: 'اللغة',
      subtitle: 'اختر لغة الواجهة.',
      close: 'إغلاق محدد اللغة',
    },
    start: {
      ...en.start,
      quotes: [
        '“هل يمكن لرفرفة جناح فراشة في البرازيل أن تطلق إعصارًا في تكساس؟”',
        '“لا بد أن يحمل المرء فوضى في داخله كي يلد نجمًا راقصًا.”',
      ],
      camera: 'الكاميرا',
      music: 'الموسيقى',
      enableCamera: 'فعّل الكاميرا للمعاينة',
      startingCamera: 'جارٍ تشغيل الكاميرا…',
      cameraUnavailable: 'الكاميرا غير متاحة — اضغط للمحاولة مجددًا',
      rotateCamera: 'تدوير الكاميرا',
      fixAspect: 'إصلاح التمدد',
      help: 'كيف يعمل',
      enterChaos: 'ادخل الفوضى',
      privacyHtml:
        '<strong>100% على جهازك.</strong> الكاميرا والصور والفيديوهات لا تغادر جهازك أبدًا — لا توجد خدمة خلفية ولا يتم رفع أي شيء.',
      systemRequirements: 'متطلبات النظام',
      photosensitivityHtml:
        '<strong>تحذير حساسية الضوء.</strong> يحتوي على أضواء وامضة وتأثيرات ستروب وتغيّرات لونية سريعة.',
      headphonesHtml: '<strong>يُنصح باستخدام سماعات الرأس.</strong>',
    },
    controls: {
      shapeLabels: ['مسطح', 'مكعب', 'كرة'],
      shapeBadges: ['', 'مكعب', 'كرة'],
      audioLabels: ['الموسيقى صامتة', 'الموسيقى'],
      followLabels: ['عرض حر', 'اتبع A', 'اتبع B', 'أثر A', 'أثر B'],
      trackFallback: 'مقطع',
      trailOff: 'الأثر متوقف',
      splitOn: 'التقسيم مفعل',
      splitOff: 'التقسيم متوقف',
      frameMargin: 'الإطار',
      cameraOn: 'الكاميرا مفعلة',
      cameraOff: 'الكاميرا متوقفة',
      speedPad: 'لوحة السرعة',
      snapshot: 'لقطة 5 ث',
      export: 'تصدير',
      finishingCapture: 'جارٍ إنهاء الالتقاط…',
      autoOn: 'تلقائي مفعل',
      autoOff: 'تلقائي متوقف',
      help: 'مساعدة',
    },
    legend: makeTranslatedLegend('ar'),
    exportMenu: makeTranslatedExport('ar'),
    unsupported: {
      messageHtml:
        'WebGPU غير متاح في هذا المتصفح.<br />يتطلب Safari macOS Tahoe 26 أو iOS/iPadOS 26 أو visionOS 26+. على macOS Sequoia/Sonoma استخدم Chrome/Edge حديثًا.',
    },
  },
  ru: {
    ...en,
    common: {
      close: 'Закрыть',
      reload: 'Перезагрузить',
      cancel: 'Отмена',
      delete: 'Удалить',
      download: 'Скачать',
      share: 'Поделиться',
    },
    language: {
      buttonLabel: 'Сменить язык',
      title: 'Язык',
      subtitle: 'Выберите язык интерфейса.',
      close: 'Закрыть выбор языка',
    },
    start: {
      ...en.start,
      quotes: [
        '«Может ли взмах крыла бабочки в Бразилии вызвать торнадо в Техасе?»',
        '«Нужно ещё носить в себе хаос, чтобы родить танцующую звезду.»',
      ],
      camera: 'Камера',
      music: 'Музыка',
      enableCamera: 'Включите камеру для предпросмотра',
      startingCamera: 'Запуск камеры…',
      cameraUnavailable: 'Камера недоступна — коснитесь, чтобы повторить',
      rotateCamera: 'Повернуть камеру',
      fixAspect: 'Исправить растяжение',
      help: 'Как это работает',
      enterChaos: 'Войти в хаос',
      privacyHtml:
        '<strong>100% на устройстве.</strong> Камера, фото и видео никогда не покидают устройство — нет backend, ничего не загружается.',
      systemRequirements: 'Системные требования',
      photosensitivityHtml:
        '<strong>Предупреждение о светочувствительности.</strong> Содержит вспышки, стробоскопические эффекты и быстрые смены цвета.',
      headphonesHtml: '<strong>Рекомендуются наушники.</strong>',
    },
    controls: {
      shapeLabels: ['Плоскость', 'Куб', 'Сфера'],
      shapeBadges: ['', 'Куб', 'Сфера'],
      audioLabels: ['Музыка без звука', 'Музыка'],
      followLabels: ['Свободный вид', 'Следить A', 'Следить B', 'След A', 'След B'],
      trackFallback: 'Трек',
      trailOff: 'След выкл.',
      splitOn: 'Разделение вкл.',
      splitOff: 'Разделение выкл.',
      frameMargin: 'Кадр',
      cameraOn: 'Камера вкл.',
      cameraOff: 'Камера выкл.',
      speedPad: 'Скорость',
      snapshot: 'Снимок 5с',
      export: 'Экспорт',
      finishingCapture: 'Завершаем запись…',
      autoOn: 'Авто вкл.',
      autoOff: 'Авто выкл.',
      help: 'Помощь',
    },
    legend: makeTranslatedLegend('ru'),
    exportMenu: makeTranslatedExport('ru'),
    unsupported: {
      messageHtml:
        'WebGPU недоступен в этом браузере.<br />Safari требует macOS Tahoe 26, iOS/iPadOS 26 или visionOS 26+. На macOS Sequoia/Sonoma используйте свежий Chrome/Edge.',
    },
  },
  it: {
    ...en,
    common: {
      close: 'Chiudi',
      reload: 'Ricarica',
      cancel: 'Annulla',
      delete: 'Elimina',
      download: 'Scarica',
      share: 'Condividi',
    },
    language: {
      buttonLabel: 'Cambia lingua',
      title: 'Lingua',
      subtitle: 'Scegli la lingua dell’interfaccia.',
      close: 'Chiudi il selettore lingua',
    },
    start: {
      ...en.start,
      quotes: [
        '“Il battito d’ali di una farfalla in Brasile può scatenare un tornado in Texas?”',
        '“Bisogna avere ancora caos dentro di sé per partorire una stella danzante.”',
      ],
      camera: 'Fotocamera',
      music: 'Musica',
      enableCamera: 'Attiva la fotocamera per l’anteprima',
      startingCamera: 'Avvio fotocamera…',
      cameraUnavailable: 'Fotocamera non disponibile — tocca per riprovare',
      rotateCamera: 'Ruota fotocamera',
      fixAspect: 'Correggi stiramento',
      help: 'Come funziona',
      enterChaos: 'Entra nel caos',
      privacyHtml:
        '<strong>100% sul dispositivo.</strong> Fotocamera, foto e video non lasciano mai il dispositivo — nessun backend, nessun upload.',
      systemRequirements: 'Requisiti di sistema',
      photosensitivityHtml:
        '<strong>Avviso fotosensibilità.</strong> Contiene luci lampeggianti, strobo e rapidi cambi di colore.',
      headphonesHtml: '<strong>Cuffie consigliate.</strong>',
    },
    controls: {
      shapeLabels: ['Piano', 'Cubo', 'Sfera'],
      shapeBadges: ['', 'Cubo', 'Sfera'],
      audioLabels: ['Musica muta', 'Musica'],
      followLabels: ['Vista libera', 'Segui A', 'Segui B', 'Scia A', 'Scia B'],
      trackFallback: 'Brano',
      trailOff: 'Scia off',
      splitOn: 'Divisione attiva',
      splitOff: 'Divisione disattiva',
      frameMargin: 'Inquadratura',
      cameraOn: 'Fotocamera attiva',
      cameraOff: 'Fotocamera disattiva',
      speedPad: 'Pad velocità',
      snapshot: 'Snapshot 5s',
      export: 'Esporta',
      finishingCapture: 'Finalizzazione cattura…',
      autoOn: 'Auto on',
      autoOff: 'Auto off',
      help: 'Aiuto',
    },
    legend: makeTranslatedLegend('it'),
    exportMenu: makeTranslatedExport('it'),
    unsupported: {
      messageHtml:
        'WebGPU non è disponibile in questo browser.<br />Safari richiede macOS Tahoe 26, iOS/iPadOS 26 o visionOS 26+. Su macOS Sequoia/Sonoma usa Chrome/Edge recente.',
    },
  },
  tr: {
    ...en,
    common: {
      close: 'Kapat',
      reload: 'Yenile',
      cancel: 'İptal',
      delete: 'Sil',
      download: 'İndir',
      share: 'Paylaş',
    },
    language: {
      buttonLabel: 'Dili değiştir',
      title: 'Dil',
      subtitle: 'Arayüz dilini seçin.',
      close: 'Dil seçiciyi kapat',
    },
    start: {
      ...en.start,
      quotes: [
        '“Brezilya’daki bir kelebeğin kanat çırpışı Teksas’ta bir kasırga başlatabilir mi?”',
        '“Dans eden bir yıldız doğurmak için insanın içinde hâlâ kaos olmalı.”',
      ],
      camera: 'Kamera',
      music: 'Müzik',
      enableCamera: 'Önizleme için kamerayı açın',
      startingCamera: 'Kamera başlatılıyor…',
      cameraUnavailable: 'Kamera kullanılamıyor — tekrar denemek için dokunun',
      rotateCamera: 'Kamerayı döndür',
      fixAspect: 'Gerilmeyi düzelt',
      help: 'Nasıl çalışır',
      enterChaos: 'Kaosa gir',
      privacyHtml:
        '<strong>%100 cihaz üzerinde.</strong> Kameranız, fotoğraflarınız ve videolarınız cihazınızdan çıkmaz — backend yok, yükleme yok.',
      systemRequirements: 'Sistem gereksinimleri',
      photosensitivityHtml:
        '<strong>Işığa duyarlılık uyarısı.</strong> Yanıp sönen ışıklar, strobe efektleri ve hızlı renk değişimleri içerir.',
      headphonesHtml: '<strong>Kulaklık önerilir.</strong>',
    },
    controls: {
      shapeLabels: ['Düzlem', 'Küp', 'Küre'],
      shapeBadges: ['', 'Küp', 'Küre'],
      audioLabels: ['Müzik sessiz', 'Müzik'],
      followLabels: ['Serbest görünüm', 'A’yı takip', 'B’yi takip', 'İz A', 'İz B'],
      trackFallback: 'Parça',
      trailOff: 'İz kapalı',
      splitOn: 'Bölme açık',
      splitOff: 'Bölme kapalı',
      frameMargin: 'Kadraj',
      cameraOn: 'Kamera açık',
      cameraOff: 'Kamera kapalı',
      speedPad: 'Hız pedi',
      snapshot: '5 sn kayıt',
      export: 'Dışa aktar',
      finishingCapture: 'Kayıt tamamlanıyor…',
      autoOn: 'Auto açık',
      autoOff: 'Auto kapalı',
      help: 'Yardım',
    },
    legend: makeTranslatedLegend('tr'),
    exportMenu: makeTranslatedExport('tr'),
    unsupported: {
      messageHtml:
        'WebGPU bu tarayıcıda kullanılamıyor.<br />Safari için macOS Tahoe 26, iOS/iPadOS 26 veya visionOS 26+ gerekir. macOS Sequoia/Sonoma’da güncel Chrome/Edge kullanın.',
    },
  },
  bn: {
    ...en,
    common: {
      close: 'বন্ধ',
      reload: 'রিলোড',
      cancel: 'বাতিল',
      delete: 'মুছুন',
      download: 'ডাউনলোড',
      share: 'শেয়ার',
    },
    language: {
      buttonLabel: 'ভাষা বদলান',
      title: 'ভাষা',
      subtitle: 'ইন্টারফেসের ভাষা বেছে নিন।',
      close: 'ভাষা নির্বাচন বন্ধ করুন',
    },
    start: {
      ...en.start,
      quotes: [
        '“ব্রাজিলে প্রজাপতির ডানা ঝাপটানো কি টেক্সাসে টর্নেডো তুলতে পারে?”',
        '“নাচতে থাকা একটি নক্ষত্র জন্ম দিতে হলে নিজের ভেতরে এখনও বিশৃঙ্খলা থাকতে হয়।”',
      ],
      camera: 'ক্যামেরা',
      music: 'সঙ্গীত',
      enableCamera: 'আগে দেখতে ক্যামেরা চালু করুন',
      startingCamera: 'ক্যামেরা চালু হচ্ছে…',
      cameraUnavailable: 'ক্যামেরা পাওয়া যাচ্ছে না — আবার চেষ্টা করতে ট্যাপ করুন',
      rotateCamera: 'ক্যামেরা ঘোরান',
      fixAspect: 'ছবির অনুপাত ঠিক করুন',
      help: 'কীভাবে কাজ করে',
      enterChaos: 'কেওসে প্রবেশ',
      privacyHtml:
        '<strong>100% ডিভাইসেই।</strong> আপনার ক্যামেরা, ছবি এবং ভিডিও কখনও ডিভাইস ছাড়ে না — কোনো সার্ভার-পক্ষ নেই, কিছু আপলোড হয় না।',
      systemRequirements: 'সিস্টেম প্রয়োজনীয়তা',
      photosensitivityHtml:
        '<strong>আলোর প্রতি সংবেদনশীলতার সতর্কতা।</strong> এতে ঝলকানি এবং দ্রুত রঙ পরিবর্তন আছে।',
      headphonesHtml: '<strong>হেডফোন ব্যবহার করা ভালো।</strong>',
    },
    controls: {
      shapeLabels: ['সমতল', 'ঘনক', 'গোলক'],
      shapeBadges: ['', 'ঘনক', 'গোলক'],
      audioLabels: ['সঙ্গীত নিঃশব্দ', 'সঙ্গীত'],
      followLabels: ['মুক্ত দৃশ্য', 'A অনুসরণ', 'B অনুসরণ', 'পথরেখা A', 'পথরেখা B'],
      trackFallback: 'ট্র্যাক',
      trailOff: 'পথরেখা বন্ধ',
      splitOn: 'বিভাজন চালু',
      splitOff: 'বিভাজন বন্ধ',
      frameMargin: 'ফ্রেম',
      cameraOn: 'ক্যামেরা চালু',
      cameraOff: 'ক্যামেরা বন্ধ',
      speedPad: 'গতি প্যাড',
      snapshot: '৫ সেকেন্ড রেকর্ড',
      export: 'রপ্তানি',
      finishingCapture: 'রেকর্ড শেষ করা হচ্ছে…',
      autoOn: 'স্বয়ংক্রিয় চালু',
      autoOff: 'স্বয়ংক্রিয় বন্ধ',
      help: 'সাহায্য',
    },
    legend: makeTranslatedLegend('bn'),
    exportMenu: makeTranslatedExport('bn'),
    unsupported: {
      messageHtml:
        'এই ব্রাউজারে WebGPU নেই।<br />Safari-এর জন্য macOS Tahoe 26, iOS/iPadOS 26 বা visionOS 26+ দরকার। macOS Sequoia/Sonoma-এ নতুন Chrome/Edge ব্যবহার করুন।',
    },
  },
};

type CompactLocale = Exclude<Locale, 'en' | 'fr'>;

function makeTranslatedLegend(locale: CompactLocale): Translation['legend'] {
  const base = en.legend;
  const tables: Record<
    CompactLocale,
    Partial<Translation['legend']> & { items: Partial<Translation['legend']['items']> }
  > = {
    de: {
      controlsTitle: 'Steuerung',
      exportClipsTitle: 'Teilen & Export — Clips',
      exportTitle: 'Teilen & Export',
      requirementsTitle: 'Systemanforderungen',
      creditsTitle: 'Credits',
      previousPage: 'Vorherige Seite',
      nextPage: 'Nächste Seite',
      gestureControls: 'Gestensteuerung',
      credits: {
        line1: 'Lorenz Clash — ein WebGPU-Erlebnis, an dem du teilnimmst.',
        line2: 'Erstellt von André Frélicot.',
        date: 'Juni 2026',
        privacyTitle: 'Datenschutz',
        privacyLine1:
          'Alles läuft auf deinem Gerät. Kamera, Fotos und Videos verlassen es nie — kein Backend.',
        privacyLine2:
          'Nur anonyme Besuchszählung, ohne Cookies, IP-Tracking oder personenbezogene Daten.',
      },
      items: {
        shapeName: 'Form',
        shapeDesc: 'Wechselt die Kartenform: Ebene → Würfel → Kugel.',
        trailName: 'Spur',
        trailDesc: 'Folgt der Spur von Kurve A → B.',
        viewName: 'Ansicht',
        viewDesc: 'Wechselt die Kamera: freie Umlaufbahn → Kurve A → Kurve B.',
        snapshotName: 'Snapshot',
        snapshotDesc:
          'Nimmt 5 Sekunden der Live-Ansicht auf. Hintergrundauftritte werden auch automatisch gesammelt.',
        musicName: 'Musik',
        musicDesc: 'Ton oder stumm — die Musik steuert die Visuals immer.',
        splitName: 'Teilung',
        splitDesc: 'Kurve A nutzt die Kamera, Kurve B synthetische Materie.',
        cameraName: 'Kamera',
        cameraDesc: 'Schaltet die Live-Kamera als visuelles Material ein oder aus.',
        exportName: 'Export',
        exportDesc: 'Clips ansehen, sortieren, Sound wählen und ein Video erzeugen.',
        trackName: 'Track',
        trackDesc: 'Springt zum nächsten Musikstück.',
        frameName: 'Ausschnitt',
        frameDesc: 'Öffnet einen Fader für den Bildausschnitt der freien Ansicht.',
        speedName: 'Tempo',
        speedDesc:
          'Öffnet ein XY-Pad für die Kurvengeschwindigkeit. Doppelklick/-tipp setzt zurück.',
        autoName: 'Auto',
        autoDesc: 'Automatische Regie — wechselt Kamera und Formen im Takt der Musik.',
        slowmoName: 'Zeitlupe',
        slowmoDesc: 'Gedrückt halten und ziehen — nach unten verlangsamt Zeit und Musik.',
        pinchName: 'Aufziehen',
        pinchDesc: 'Zwei Finger spreizen zum Zoomen; beim Loslassen federt es zurück.',
        clipsName: 'Clips',
        clipsDesc:
          'Snapshots und automatische Auftritte sammeln sich hier. Ziehen zum Sortieren, tippen zur Vorschau.',
        includeName: 'Einbeziehen',
        includeDesc: 'Legt fest, ob der Clip im Export enthalten ist.',
        keepName: 'Behalten',
        keepDesc: 'Markiert einen Clip, damit er nie automatisch gelöscht wird.',
        deleteName: 'Löschen',
        deleteDesc: 'Löscht einen Clip oder alle nicht markierten Clips.',
        soundName: 'Sound',
        soundDesc:
          'Musik einbeziehen. Synchron = jeder Clip behält seinen Moment; Kontinuierlich = ein Track.',
        generateName: 'Erzeugen',
        generateDesc: 'Rendert die Clips zu einem Video zum Herunterladen oder Teilen.',
        deviceLimitsName: 'Gerätelimits',
        deviceLimitsDesc: 'Auflösung und Framerate passen sich an Speicher und Gerät an.',
        browserName: 'Browser',
        browserDesc:
          'Lorenz Clash benötigt WebGPU und eine sichere HTTPS-Verbindung. Safari stellt WebGPU unter macOS Tahoe 26+, iOS/iPadOS 26+ und visionOS 26+ bereit.',
        recommendedName: 'Empfohlen',
        recommendedDesc:
          'Aktuelles Chrome/Edge auf Desktop, aktuelles Android-Flaggschiff oder leistungsstarkes oberes Mittelklassegerät mit Chrome auf Android 12+ oder Safari 26 auf einem unterstützten Apple-OS.',
        olderDevicesName: 'Ältere Geräte',
        olderDevicesDesc:
          'Safari 26 auf macOS Sequoia/Sonoma stellt WebGPU nicht bereit; nutze dort Chrome/Edge. Android-Leistung variiert stark, besonders mit Kamera und Videoexport.',
      },
    },
    es: {
      controlsTitle: 'Controles',
      exportClipsTitle: 'Compartir y exportar — Clips',
      exportTitle: 'Compartir y exportar',
      requirementsTitle: 'Requisitos del sistema',
      creditsTitle: 'Créditos',
      previousPage: 'Página anterior',
      nextPage: 'Página siguiente',
      gestureControls: 'Controles gestuales',
      credits: {
        line1: 'Lorenz Clash — una experiencia WebGPU de la que formas parte.',
        line2: 'Creado por André Frélicot.',
        date: 'Junio de 2026',
        privacyTitle: 'Privacidad',
        privacyLine1:
          'Todo se ejecuta en tu dispositivo. Cámara, fotos y videos nunca salen de él — no hay backend.',
        privacyLine2:
          'Solo conteo anónimo de visitas, sin cookies, seguimiento IP ni datos personales.',
      },
      items: {
        shapeName: 'Forma',
        shapeDesc: 'Cambia la forma: plano → cubo → esfera.',
        trailName: 'Estela',
        trailDesc: 'Sigue la estela de la curva A → B.',
        viewName: 'Vista',
        viewDesc: 'Cambia la cámara: órbita libre → seguir A → seguir B.',
        snapshotName: 'Captura',
        snapshotDesc:
          'Graba 5 segundos de la vista. Las apariciones de fondo también se capturan automáticamente.',
        musicName: 'Música',
        musicDesc: 'Activa sonido o silencio — la música siempre impulsa los visuales.',
        splitName: 'División',
        splitDesc: 'La curva A usa la cámara; la B usa materia sintética.',
        cameraName: 'Cámara',
        cameraDesc: 'Enciende o apaga la cámara como material visual.',
        exportName: 'Exportar',
        exportDesc: 'Previsualiza, reordena, elige sonido y crea un video.',
        trackName: 'Pista',
        trackDesc: 'Salta a la siguiente pista.',
        frameName: 'Encuadre',
        frameDesc: 'Abre un fader para ajustar la vista de órbita libre.',
        speedName: 'Velocidad',
        speedDesc: 'Abre un pad XY para la velocidad. Doble clic/toque restaura valores.',
        autoName: 'Auto',
        autoDesc: 'Director automático — cambia cámara y formas al ritmo de la música.',
        slowmoName: 'Cámara lenta',
        slowmoDesc: 'Mantén y arrastra — hacia abajo ralentiza el tiempo y la música.',
        pinchName: 'Pellizcar',
        pinchDesc: 'Separa dos dedos para acercar; vuelve al soltar.',
        clipsName: 'Clips',
        clipsDesc: 'Capturas y apariciones automáticas se reúnen aquí. Arrastra para reordenar.',
        includeName: 'Incluir',
        includeDesc: 'Decide si el clip entra en el video exportado.',
        keepName: 'Guardar',
        keepDesc: 'Marca un clip para que nunca se borre automáticamente.',
        deleteName: 'Eliminar',
        deleteDesc: 'Elimina un clip o todos los no guardados.',
        soundName: 'Sonido',
        soundDesc:
          'Incluye la música. Sincronizado = cada clip conserva su momento; Continuo = una pista.',
        generateName: 'Generar',
        generateDesc: 'Renderiza los clips en un video para descargar o compartir.',
        deviceLimitsName: 'Límites del dispositivo',
        deviceLimitsDesc: 'Resolución y fps se adaptan a la memoria del dispositivo.',
        browserName: 'Navegador',
        browserDesc:
          'Lorenz Clash requiere WebGPU y una conexión HTTPS segura. Safari expone WebGPU en macOS Tahoe 26+, iOS/iPadOS 26+ y visionOS 26+.',
        recommendedName: 'Recomendado',
        recommendedDesc:
          'Chrome/Edge reciente en escritorio, Android flagship reciente o gama media-alta orientada al rendimiento con Chrome en Android 12+, o Safari 26 en un sistema Apple compatible.',
        olderDevicesName: 'Dispositivos antiguos',
        olderDevicesDesc:
          'Safari 26 en macOS Sequoia/Sonoma no expone WebGPU; usa Chrome/Edge ahí. El rendimiento Android varía mucho, especialmente con cámara y exportación de video.',
      },
    },
    'pt-BR': {
      controlsTitle: 'Controles',
      exportClipsTitle: 'Compartilhar e exportar — Clipes',
      exportTitle: 'Compartilhar e exportar',
      requirementsTitle: 'Requisitos do sistema',
      creditsTitle: 'Créditos',
      previousPage: 'Página anterior',
      nextPage: 'Próxima página',
      gestureControls: 'Controles por gesto',
      credits: {
        line1: 'Lorenz Clash — uma experiência WebGPU da qual você faz parte.',
        line2: 'Criado por André Frélicot.',
        date: 'Junho de 2026',
        privacyTitle: 'Privacidade',
        privacyLine1:
          'Tudo roda no seu dispositivo. Câmera, fotos e vídeos nunca saem dele — não há backend.',
        privacyLine2:
          'Apenas contagem anônima de visitas, sem cookies, rastreamento de IP ou dados pessoais.',
      },
      items: {
        shapeName: 'Forma',
        shapeDesc: 'Alterna a forma: plano → cubo → esfera.',
        trailName: 'Rastro',
        trailDesc: 'Segue o rastro da curva A → B.',
        viewName: 'Vista',
        viewDesc: 'Troca a câmera: órbita livre → seguir A → seguir B.',
        snapshotName: 'Captura',
        snapshotDesc:
          'Grava 5 segundos da vista. Aparições de fundo também são capturadas automaticamente.',
        musicName: 'Música',
        musicDesc: 'Som ou mudo — a música sempre guia os visuais.',
        splitName: 'Divisão',
        splitDesc: 'A curva A usa a câmera; a B usa matéria sintética.',
        cameraName: 'Câmera',
        cameraDesc: 'Liga ou desliga a câmera como material visual.',
        exportName: 'Exportar',
        exportDesc: 'Pré-visualize, reordene, escolha som e gere um vídeo.',
        trackName: 'Faixa',
        trackDesc: 'Pula para a próxima música.',
        frameName: 'Enquadrar',
        frameDesc: 'Abre um fader para ajustar a vista livre.',
        speedName: 'Velocidade',
        speedDesc: 'Abre um pad XY para a velocidade. Duplo toque/clique restaura os padrões.',
        autoName: 'Auto',
        autoDesc: 'Diretor automático — muda câmera e formas no tempo da música.',
        slowmoName: 'Slow-mo',
        slowmoDesc: 'Segure e arraste — para baixo desacelera tempo e música.',
        pinchName: 'Pinça',
        pinchDesc: 'Afaste dois dedos para dar zoom; volta ao soltar.',
        clipsName: 'Clipes',
        clipsDesc: 'Capturas e aparições automáticas ficam aqui. Arraste para reordenar.',
        includeName: 'Incluir',
        includeDesc: 'Define se o clipe entra no vídeo exportado.',
        keepName: 'Manter',
        keepDesc: 'Marca um clipe para nunca ser apagado automaticamente.',
        deleteName: 'Excluir',
        deleteDesc: 'Exclui um clipe ou todos os não marcados.',
        soundName: 'Som',
        soundDesc:
          'Inclui a música. Sincronizado = cada clipe mantém seu momento; Contínuo = uma faixa.',
        generateName: 'Gerar',
        generateDesc: 'Renderiza os clipes em um vídeo para baixar ou compartilhar.',
        deviceLimitsName: 'Limites do dispositivo',
        deviceLimitsDesc: 'Resolução e fps se adaptam à memória do dispositivo.',
        browserName: 'Navegador',
        browserDesc:
          'Lorenz Clash requer WebGPU e uma conexão HTTPS segura. O Safari expõe WebGPU no macOS Tahoe 26+, iOS/iPadOS 26+ e visionOS 26+.',
        recommendedName: 'Recomendado',
        recommendedDesc:
          'Chrome/Edge recente no desktop, Android flagship recente ou intermediário premium focado em desempenho com Chrome no Android 12+, ou Safari 26 em um Apple OS compatível.',
        olderDevicesName: 'Dispositivos antigos',
        olderDevicesDesc:
          'Safari 26 no macOS Sequoia/Sonoma não expõe WebGPU; use Chrome/Edge nesses OS. O desempenho Android varia muito, especialmente com câmera e exportação de vídeo.',
      },
    },
    ja: {
      controlsTitle: '操作',
      exportClipsTitle: '共有と書き出し — クリップ',
      exportTitle: '共有と書き出し',
      requirementsTitle: '動作環境',
      creditsTitle: 'クレジット',
      previousPage: '前のページ',
      nextPage: '次のページ',
      gestureControls: 'ジェスチャー操作',
      credits: {
        line1: 'Lorenz Clash — あなたが参加する WebGPU 体験。',
        line2: '制作：André Frélicot',
        date: '2026年6月',
        privacyTitle: 'プライバシー',
        privacyLine1:
          'すべて端末上で動作します。カメラ、写真、動画は端末から出ません — バックエンドはありません。',
        privacyLine2: '匿名の訪問数のみ。Cookie、IP追跡、個人データはありません。',
      },
      items: {
        shapeName: '形状',
        shapeDesc: '形状を切り替えます：平面 → キューブ → 球。',
        trailName: '軌跡',
        trailDesc: '曲線 A → B の軌跡を追います。',
        viewName: '視点',
        viewDesc: '自由視点 → A追跡 → B追跡に切り替えます。',
        snapshotName: '録画',
        snapshotDesc: 'ライブビューを5秒録画。背景の出現も自動で収集されます。',
        musicName: '音楽',
        musicDesc: '音あり/ミュートを切替。音楽は常に映像を駆動します。',
        splitName: '分割',
        splitDesc: 'A はカメラ、B は合成素材を使います。',
        cameraName: 'カメラ',
        cameraDesc: 'ライブカメラを視覚素材としてオン/オフします。',
        exportName: '書き出し',
        exportDesc: 'クリップを確認、並べ替え、音を選び、動画を作成します。',
        trackName: '曲',
        trackDesc: '次の曲へスキップします。',
        frameName: 'フレーム',
        frameDesc: '自由視点のフレーミングを調整します。',
        speedName: '速度',
        speedDesc: 'XYパッドで速度を調整。ダブルクリック/タップでリセット。',
        autoName: '自動',
        autoDesc: '自動ディレクター — 音楽に合わせて視点と形状を切替。',
        slowmoName: 'スロー',
        slowmoDesc: '長押ししてドラッグ — 下へ引くと時間と音楽が遅くなります。',
        pinchName: 'ピンチ',
        pinchDesc: '二本指を広げてズーム。離すと戻ります。',
        clipsName: 'クリップ',
        clipsDesc: '録画と自動出現がここに集まります。ドラッグで並べ替え。',
        includeName: '含める',
        includeDesc: '書き出し動画に含めるかを切替。',
        keepName: '保持',
        keepDesc: '自動削除されないようクリップを保持します。',
        deleteName: '削除',
        deleteDesc: 'クリップまたは未保持クリップを削除します。',
        soundName: '音',
        soundDesc: '音楽を含めます。同期 = 各クリップの時点、連続 = 1本の曲。',
        generateName: '生成',
        generateDesc: 'クリップを1本の動画にしてダウンロード/共有します。',
        deviceLimitsName: '端末制限',
        deviceLimitsDesc: '解像度とフレームレートは端末のメモリに合わせて調整されます。',
        browserName: 'ブラウザ',
        browserDesc:
          'Lorenz Clash には WebGPU と安全な HTTPS 接続が必要です。Safari は macOS Tahoe 26+、iOS/iPadOS 26+、visionOS 26+ で WebGPU を公開します。',
        recommendedName: '推奨',
        recommendedDesc:
          'デスクトップでは最新の Chrome/Edge、Android 12+ の Chrome で動く新しめの Android フラッグシップまたは高性能ミドルハイ端末、または対応 Apple OS の Safari 26。',
        olderDevicesName: '古い端末',
        olderDevicesDesc:
          'macOS Sequoia/Sonoma の Safari 26 は WebGPU を公開しません。その OS では Chrome/Edge を使ってください。Android の性能差は特にカメラや動画書き出しで大きく出ます。',
      },
    },
    ko: {
      controlsTitle: '컨트롤',
      exportClipsTitle: '공유 및 내보내기 — 클립',
      exportTitle: '공유 및 내보내기',
      requirementsTitle: '시스템 요구 사항',
      creditsTitle: '크레딧',
      previousPage: '이전 페이지',
      nextPage: '다음 페이지',
      gestureControls: '제스처 컨트롤',
      credits: {
        line1: 'Lorenz Clash — 당신이 일부가 되는 WebGPU 경험.',
        line2: '제작: André Frélicot.',
        date: '2026년 6월',
        privacyTitle: '개인정보',
        privacyLine1: '모든 것은 기기에서 실행됩니다. 카메라, 사진, 영상은 기기를 떠나지 않습니다.',
        privacyLine2: '익명 방문 수만 집계하며 쿠키, IP 추적, 개인 데이터는 없습니다.',
      },
      items: {
        shapeName: '형태',
        shapeDesc: '형태 전환: 평면 → 큐브 → 구.',
        trailName: '잔상',
        trailDesc: '곡선 A → B의 잔상을 따라갑니다.',
        viewName: '시점',
        viewDesc: '자유 시점 → A 추적 → B 추적으로 전환합니다.',
        snapshotName: '캡처',
        snapshotDesc: '라이브 뷰 5초를 녹화합니다. 배경 장면도 자동으로 수집됩니다.',
        musicName: '음악',
        musicDesc: '소리/음소거 전환 — 음악은 항상 비주얼을 구동합니다.',
        splitName: '분할',
        splitDesc: 'A는 카메라, B는 합성 물질을 사용합니다.',
        cameraName: '카메라',
        cameraDesc: '라이브 카메라를 시각 재료로 켜거나 끕니다.',
        exportName: '내보내기',
        exportDesc: '클립 미리보기, 정렬, 사운드 선택 후 영상을 만듭니다.',
        trackName: '트랙',
        trackDesc: '다음 음악 트랙으로 이동합니다.',
        frameName: '프레임',
        frameDesc: '자유 시점의 프레이밍을 조정합니다.',
        speedName: '속도',
        speedDesc: 'XY 패드로 속도를 조절합니다. 더블 클릭/탭으로 기본값 복원.',
        autoName: '자동',
        autoDesc: '자동 디렉터 — 음악에 맞춰 카메라와 형태를 전환합니다.',
        slowmoName: '슬로모션',
        slowmoDesc: '누른 채 드래그 — 아래로 당기면 시간과 음악이 느려집니다.',
        pinchName: '핀치',
        pinchDesc: '두 손가락을 벌려 확대하고 놓으면 돌아옵니다.',
        clipsName: '클립',
        clipsDesc: '캡처와 자동 장면이 여기에 모입니다. 드래그로 정렬.',
        includeName: '포함',
        includeDesc: '클립을 내보낼 영상에 포함할지 전환합니다.',
        keepName: '보관',
        keepDesc: '클립을 자동 삭제되지 않게 보관합니다.',
        deleteName: '삭제',
        deleteDesc: '클립 또는 보관하지 않은 클립을 삭제합니다.',
        soundName: '사운드',
        soundDesc: '음악 포함. 동기화 = 각 클립의 순간, 연속 = 한 트랙.',
        generateName: '생성',
        generateDesc: '클립을 하나의 영상으로 렌더링해 다운로드/공유합니다.',
        deviceLimitsName: '기기 제한',
        deviceLimitsDesc: '해상도와 프레임레이트는 기기 메모리에 맞춰 조정됩니다.',
        browserName: '브라우저',
        browserDesc:
          'Lorenz Clash에는 WebGPU와 안전한 HTTPS 연결이 필요합니다. Safari는 macOS Tahoe 26+, iOS/iPadOS 26+ 및 visionOS 26+에서 WebGPU를 노출합니다.',
        recommendedName: '권장',
        recommendedDesc:
          '데스크톱의 최신 Chrome/Edge, Android 12+ Chrome을 실행하는 최신 Android 플래그십 또는 성능 중심 상위 중급폰, 또는 지원되는 Apple OS의 Safari 26.',
        olderDevicesName: '오래된 기기',
        olderDevicesDesc:
          'macOS Sequoia/Sonoma의 Safari 26은 WebGPU를 노출하지 않습니다. 해당 OS에서는 Chrome/Edge를 사용하세요. Android 성능은 특히 카메라와 영상 내보내기에서 크게 다릅니다.',
      },
    },
    'zh-Hans': {
      controlsTitle: '控制',
      exportClipsTitle: '分享与导出 — 片段',
      exportTitle: '分享与导出',
      requirementsTitle: '系统要求',
      creditsTitle: '致谢',
      previousPage: '上一页',
      nextPage: '下一页',
      gestureControls: '手势控制',
      credits: {
        line1: 'Lorenz Clash — 你参与其中的 WebGPU 体验。',
        line2: '创作：André Frélicot。',
        date: '2026 年 6 月',
        privacyTitle: '隐私',
        privacyLine1: '一切都在设备上运行。相机、照片和视频不会离开设备 — 没有后端。',
        privacyLine2: '仅匿名统计访问次数，不使用 Cookie、不跟踪 IP、不收集个人数据。',
      },
      items: {
        shapeName: '形状',
        shapeDesc: '切换形状：平面 → 立方体 → 球体。',
        trailName: '轨迹',
        trailDesc: '跟随曲线 A → B 的轨迹。',
        viewName: '视角',
        viewDesc: '切换相机：自由环绕 → 跟随 A → 跟随 B。',
        snapshotName: '录制',
        snapshotDesc: '录制 5 秒实时画面。背景片段也会自动收集。',
        musicName: '音乐',
        musicDesc: '声音或静音 — 音乐始终驱动画面。',
        splitName: '分屏',
        splitDesc: '曲线 A 使用相机，曲线 B 使用合成材质。',
        cameraName: '相机',
        cameraDesc: '将实时相机作为视觉材质开启或关闭。',
        exportName: '导出',
        exportDesc: '预览、排序、选择声音，然后生成视频。',
        trackName: '曲目',
        trackDesc: '跳到下一首音乐。',
        frameName: '取景',
        frameDesc: '打开滑杆，调整自由视角的取景。',
        speedName: '速度',
        speedDesc: '打开 XY 面板设置速度。双击/双点恢复默认。',
        autoName: '自动',
        autoDesc: '自动导演 — 随音乐切换相机和形状。',
        slowmoName: '慢动作',
        slowmoDesc: '按住并拖动 — 向下拖会放慢时间和音乐。',
        pinchName: '双指缩放',
        pinchDesc: '双指张开缩放，松开后回弹。',
        clipsName: '片段',
        clipsDesc: '录制和自动片段会收集在这里。拖动可排序。',
        includeName: '包含',
        includeDesc: '切换此片段是否进入导出视频。',
        keepName: '保留',
        keepDesc: '标记片段，使其不会被自动删除。',
        deleteName: '删除',
        deleteDesc: '删除单个片段，或清除未保留片段。',
        soundName: '声音',
        soundDesc: '包含音乐。同步 = 每个片段保留自己的时刻；连续 = 一条完整音乐。',
        generateName: '生成',
        generateDesc: '将片段渲染为一个视频，然后下载或分享。',
        deviceLimitsName: '设备限制',
        deviceLimitsDesc: '导出分辨率和帧率会根据设备内存调整。',
        browserName: '浏览器',
        browserDesc:
          'Lorenz Clash 需要 WebGPU 和安全的 HTTPS 连接。Safari 在 macOS Tahoe 26+、iOS/iPadOS 26+ 和 visionOS 26+ 上提供 WebGPU。',
        recommendedName: '推荐',
        recommendedDesc:
          '桌面端新版 Chrome/Edge、运行 Android 12+ Chrome 的近期 Android 旗舰机或性能型中高端机，或受支持 Apple OS 上的 Safari 26。',
        olderDevicesName: '旧设备',
        olderDevicesDesc:
          'macOS Sequoia/Sonoma 上的 Safari 26 不会暴露 WebGPU；请在这些系统上使用 Chrome/Edge。Android 性能差异很大，尤其是在相机和视频导出时。',
      },
    },
    th: {
      controlsTitle: 'การควบคุม',
      exportClipsTitle: 'แชร์และส่งออก — คลิป',
      exportTitle: 'แชร์และส่งออก',
      requirementsTitle: 'ความต้องการของระบบ',
      creditsTitle: 'เครดิต',
      previousPage: 'หน้าก่อนหน้า',
      nextPage: 'หน้าถัดไป',
      gestureControls: 'ควบคุมด้วยท่าทาง',
      credits: {
        line1: 'Lorenz Clash — ประสบการณ์ WebGPU ที่คุณเป็นส่วนหนึ่ง',
        line2: 'สร้างโดย André Frélicot',
        date: 'มิถุนายน 2026',
        privacyTitle: 'ความเป็นส่วนตัว',
        privacyLine1: 'ทุกอย่างทำงานบนอุปกรณ์ของคุณ กล้อง รูปภาพ และวิดีโอไม่ออกจากอุปกรณ์',
        privacyLine2:
          'นับผู้ชมแบบไม่ระบุตัวตนเท่านั้น ไม่มี cookies, IP tracking หรือข้อมูลส่วนตัว',
      },
      items: {
        shapeName: 'รูปทรง',
        shapeDesc: 'สลับรูปทรง: ระนาบ → ลูกบาศก์ → ทรงกลม',
        trailName: 'ร่องรอย',
        trailDesc: 'ตามร่องรอยของเส้นโค้ง A → B',
        viewName: 'มุมมอง',
        viewDesc: 'สลับกล้อง: มุมมองอิสระ → ตาม A → ตาม B',
        snapshotName: 'บันทึก',
        snapshotDesc: 'บันทึกภาพสด 5 วินาที และเก็บฉากพื้นหลังอัตโนมัติด้วย',
        musicName: 'เพลง',
        musicDesc: 'เปิดเสียงหรือปิดเสียง — เพลงยังขับภาพเสมอ',
        splitName: 'แบ่ง',
        splitDesc: 'เส้น A ใช้กล้อง เส้น B ใช้วัสดุสังเคราะห์',
        cameraName: 'กล้อง',
        cameraDesc: 'เปิด/ปิดกล้องสดเป็นวัสดุภาพ',
        exportName: 'ส่งออก',
        exportDesc: 'ดูตัวอย่าง จัดลำดับ เลือกเสียง แล้วสร้างวิดีโอ',
        trackName: 'เพลง',
        trackDesc: 'ข้ามไปเพลงถัดไป',
        frameName: 'เฟรม',
        frameDesc: 'เปิด fader เพื่อปรับกรอบของมุมมองอิสระ',
        speedName: 'ความเร็ว',
        speedDesc: 'เปิด XY pad เพื่อปรับความเร็ว ดับเบิลคลิก/แตะเพื่อคืนค่าเริ่มต้น',
        autoName: 'ออโต้',
        autoDesc: 'ผู้กำกับอัตโนมัติ — เปลี่ยนกล้องและรูปทรงตามจังหวะเพลง',
        slowmoName: 'สโลว์โม',
        slowmoDesc: 'กดค้างแล้วลาก — ลากลงเพื่อชะลอเวลาและเพลง',
        pinchName: 'ซูม',
        pinchDesc: 'ถ่างสองนิ้วเพื่อซูม แล้วเด้งกลับเมื่อปล่อย',
        clipsName: 'คลิป',
        clipsDesc: 'คลิปที่บันทึกและฉากอัตโนมัติจะอยู่ที่นี่ ลากเพื่อจัดลำดับ',
        includeName: 'รวม',
        includeDesc: 'เลือกว่าจะรวมคลิปนี้ในวิดีโอส่งออกหรือไม่',
        keepName: 'เก็บไว้',
        keepDesc: 'ปักดาวเพื่อไม่ให้ถูกลบอัตโนมัติ',
        deleteName: 'ลบ',
        deleteDesc: 'ลบคลิปเดียว หรือคลิปที่ไม่ได้ปักดาวทั้งหมด',
        soundName: 'เสียง',
        soundDesc: 'รวมเพลง Sync = แต่ละคลิปเก็บช่วงของตัวเอง; Continuous = เพลงต่อเนื่อง',
        generateName: 'สร้าง',
        generateDesc: 'เรนเดอร์คลิปเป็นวิดีโอเพื่อดาวน์โหลดหรือแชร์',
        deviceLimitsName: 'ข้อจำกัดอุปกรณ์',
        deviceLimitsDesc: 'ความละเอียดและ fps จะปรับตามหน่วยความจำของอุปกรณ์',
        browserName: 'เบราว์เซอร์',
        browserDesc:
          'Lorenz Clash ต้องใช้ WebGPU และการเชื่อมต่อ HTTPS ที่ปลอดภัย Safari เปิด WebGPU บน macOS Tahoe 26+, iOS/iPadOS 26+ และ visionOS 26+',
        recommendedName: 'แนะนำ',
        recommendedDesc:
          'Chrome/Edge รุ่นใหม่บนเดสก์ท็อป, Android เรือธงรุ่นใหม่หรือรุ่นกลางบนที่เน้นประสิทธิภาพพร้อม Chrome บน Android 12+, หรือ Safari 26 บน Apple OS ที่รองรับ',
        olderDevicesName: 'อุปกรณ์เก่า',
        olderDevicesDesc:
          'Safari 26 บน macOS Sequoia/Sonoma ไม่เปิด WebGPU ให้ใช้ ให้ใช้ Chrome/Edge บน OS เหล่านั้น ประสิทธิภาพ Android แตกต่างกันมาก โดยเฉพาะโหมดกล้องและการส่งออกวิดีโอ',
      },
    },
    hi: {
      controlsTitle: 'नियंत्रण',
      exportClipsTitle: 'शेयर और निर्यात — क्लिप',
      exportTitle: 'शेयर और निर्यात',
      requirementsTitle: 'सिस्टम आवश्यकताएँ',
      creditsTitle: 'श्रेय',
      previousPage: 'पिछला पृष्ठ',
      nextPage: 'अगला पृष्ठ',
      gestureControls: 'हावभाव नियंत्रण',
      credits: {
        line1: 'Lorenz Clash — एक WebGPU अनुभव जिसका आप हिस्सा हैं।',
        line2: 'André Frélicot द्वारा निर्मित।',
        date: 'जून 2026',
        privacyTitle: 'गोपनीयता',
        privacyLine1:
          'सब कुछ आपके डिवाइस पर चलता है। कैमरा, फ़ोटो और वीडियो बाहर नहीं जाते — कोई सर्वर-पक्ष नहीं।',
        privacyLine2: 'सिर्फ़ अनाम दर्शक गणना; कुकी, IP ट्रैकिंग या व्यक्तिगत डेटा नहीं।',
      },
      items: {
        shapeName: 'आकार',
        shapeDesc: 'आकार बदलें: समतल → घन → गोलक।',
        trailName: 'पथरेखा',
        trailDesc: 'वक्र A → B की पथरेखा का अनुसरण करें।',
        viewName: 'दृश्य',
        viewDesc: 'दृश्य बदलें: मुक्त कक्षा → A का अनुसरण → B का अनुसरण।',
        snapshotName: 'रिकॉर्ड',
        snapshotDesc:
          'सजीव दृश्य की 5 सेकंड क्लिप रिकॉर्ड करें। पृष्ठभूमि क्षण भी अपने आप जुटते हैं।',
        musicName: 'संगीत',
        musicDesc: 'ध्वनि या मौन — संगीत हमेशा दृश्य चलाता है।',
        splitName: 'विभाजन',
        splitDesc: 'वक्र A कैमरा रखता है, वक्र B कृत्रिम सामग्री इस्तेमाल करता है।',
        cameraName: 'कैमरा',
        cameraDesc: 'सजीव कैमरे को दृश्य सामग्री के रूप में चालू या बंद करें।',
        exportName: 'निर्यात',
        exportDesc: 'क्लिप देखें, क्रम बदलें, ध्वनि चुनें, फिर वीडियो बनाएँ।',
        trackName: 'ट्रैक',
        trackDesc: 'अगले संगीत ट्रैक पर जाएँ।',
        frameName: 'फ़्रेम',
        frameDesc: 'मुक्त दृश्य की फ़्रेमिंग कसने या ढीली करने के लिए फ़ेडर खोलें।',
        speedName: 'गति',
        speedDesc:
          'हर वक्र की गति सेट करने के लिए XY पैड खोलें। डबल-क्लिक या डबल-टैप से डिफ़ॉल्ट लौटते हैं।',
        autoName: 'स्वचालित',
        autoDesc: 'स्वचालित निर्देशक — संगीत के साथ कैमरा और आकार बदलता है।',
        slowmoName: 'स्लो-मो',
        slowmoDesc: 'दबाकर रखें, फिर खींचें — नीचे खींचने पर समय और संगीत धीमे होते हैं।',
        pinchName: 'उंगलियाँ फैलाएँ',
        pinchDesc: 'ज़ूम के लिए दो उंगलियाँ फैलाएँ; छोड़ने पर वापस आता है।',
        clipsName: 'क्लिप',
        clipsDesc: 'रिकॉर्डिंग और स्वचालित क्षण यहाँ जमा होते हैं। क्रम बदलने के लिए खींचें।',
        includeName: 'शामिल',
        includeDesc: 'क्लिप को निर्यातित वीडियो में शामिल करें या नहीं।',
        keepName: 'रखें',
        keepDesc: 'क्लिप पर तारा लगाएँ ताकि वह अपने आप न मिटे।',
        deleteName: 'हटाएँ',
        deleteDesc: 'एक क्लिप या सभी न रखे गए क्लिप हटाएँ।',
        soundName: 'ध्वनि',
        soundDesc:
          'संगीत शामिल करें। सिंक्रनाइज़ = हर क्लिप अपना समय रखती है; निरंतर = एक लगातार ट्रैक।',
        generateName: 'बनाएँ',
        generateDesc: 'क्लिप्स को एक वीडियो में रेंडर करें, फिर डाउनलोड या साझा करें।',
        deviceLimitsName: 'डिवाइस सीमाएँ',
        deviceLimitsDesc: 'निर्यात रेज़ोल्यूशन और fps डिवाइस मेमरी के हिसाब से बदलते हैं।',
        browserName: 'ब्राउज़र',
        browserDesc:
          'Lorenz Clash के लिए WebGPU और सुरक्षित HTTPS कनेक्शन चाहिए। Safari macOS Tahoe 26+, iOS/iPadOS 26+ और visionOS 26+ पर WebGPU उपलब्ध कराता है।',
        recommendedName: 'सुझाव',
        recommendedDesc:
          'डेस्कटॉप पर नया Chrome/Edge, Android 12+ Chrome वाला हाल का Android फ्लैगशिप या प्रदर्शन-केंद्रित ऊपरी मिडरेंज फ़ोन, या समर्थित Apple OS पर Safari 26।',
        olderDevicesName: 'पुराने डिवाइस',
        olderDevicesDesc:
          'macOS Sequoia/Sonoma पर Safari 26 WebGPU उपलब्ध नहीं कराता; वहाँ Chrome/Edge उपयोग करें। Android प्रदर्शन खासकर कैमरा और वीडियो निर्यात में बहुत अलग-अलग हो सकता है।',
      },
    },
    id: {
      controlsTitle: 'Kontrol',
      exportClipsTitle: 'Bagikan & Ekspor — Klip',
      exportTitle: 'Bagikan & Ekspor',
      requirementsTitle: 'Kebutuhan Sistem',
      creditsTitle: 'Kredit',
      previousPage: 'Halaman sebelumnya',
      nextPage: 'Halaman berikutnya',
      gestureControls: 'Kontrol gestur',
      credits: {
        line1: 'Lorenz Clash — pengalaman WebGPU yang Anda ikut bentuk.',
        line2: 'Dibuat oleh André Frélicot.',
        date: 'Juni 2026',
        privacyTitle: 'Privasi',
        privacyLine1:
          'Semua berjalan di perangkat Anda. Kamera, foto, dan video tidak pernah keluar — tidak ada backend.',
        privacyLine2:
          'Hanya hitungan kunjungan anonim, tanpa cookies, pelacakan IP, atau data pribadi.',
      },
      items: {
        shapeName: 'Bentuk',
        shapeDesc: 'Ganti bentuk kartu: bidang → kubus → bola.',
        trailName: 'Jejak',
        trailDesc: 'Ikuti jejak kurva A → B.',
        viewName: 'Tampilan',
        viewDesc: 'Ganti kamera: orbit bebas → ikuti A → ikuti B.',
        snapshotName: 'Snapshot',
        snapshotDesc: 'Rekam tampilan live 5 detik. Momen latar juga dikumpulkan otomatis.',
        musicName: 'Musik',
        musicDesc: 'Suara atau senyap — musik tetap menggerakkan visual.',
        splitName: 'Pisah',
        splitDesc: 'Kurva A memakai kamera, kurva B memakai materi sintetis.',
        cameraName: 'Kamera',
        cameraDesc: 'Nyalakan atau matikan kamera live sebagai bahan visual.',
        exportName: 'Ekspor',
        exportDesc: 'Pratinjau klip, susun ulang, pilih suara, lalu buat video.',
        trackName: 'Track',
        trackDesc: 'Lompat ke track musik berikutnya.',
        frameName: 'Bingkai',
        frameDesc: 'Buka fader untuk mengatur framing tampilan orbit bebas.',
        speedName: 'Kecepatan',
        speedDesc: 'Buka pad XY untuk mengatur kecepatan. Klik/ketuk ganda untuk reset.',
        autoName: 'Auto',
        autoDesc: 'Sutradara otomatis — mengganti kamera dan bentuk mengikuti musik.',
        slowmoName: 'Slow-mo',
        slowmoDesc:
          'Tekan dan tahan lalu seret — tarik ke bawah untuk memperlambat waktu dan musik.',
        pinchName: 'Pinch out',
        pinchDesc: 'Rentangkan dua jari untuk zoom; kembali saat dilepas.',
        clipsName: 'Klip',
        clipsDesc: 'Snapshot dan momen otomatis berkumpul di sini. Seret untuk menyusun ulang.',
        includeName: 'Sertakan',
        includeDesc: 'Pilih apakah klip masuk ke video ekspor.',
        keepName: 'Simpan',
        keepDesc: 'Beri bintang agar klip tidak dihapus otomatis.',
        deleteName: 'Hapus',
        deleteDesc: 'Hapus satu klip atau semua klip yang tidak disimpan.',
        soundName: 'Suara',
        soundDesc:
          'Sertakan musik. Sinkron = tiap klip mempertahankan momennya; Kontinu = satu track.',
        generateName: 'Buat',
        generateDesc: 'Render klip menjadi satu video, lalu unduh atau bagikan.',
        deviceLimitsName: 'Batas perangkat',
        deviceLimitsDesc: 'Resolusi dan fps ekspor menyesuaikan memori perangkat.',
        browserName: 'Browser',
        browserDesc:
          'Lorenz Clash membutuhkan WebGPU dan koneksi HTTPS aman. Safari mengekspos WebGPU di macOS Tahoe 26+, iOS/iPadOS 26+, dan visionOS 26+.',
        recommendedName: 'Disarankan',
        recommendedDesc:
          'Chrome/Edge terbaru di desktop, Android flagship terbaru atau upper-midrange berfokus performa dengan Chrome di Android 12+, atau Safari 26 di Apple OS yang didukung.',
        olderDevicesName: 'Perangkat lama',
        olderDevicesDesc:
          'Safari 26 di macOS Sequoia/Sonoma tidak mengekspos WebGPU; gunakan Chrome/Edge di OS tersebut. Performa Android sangat bervariasi, terutama dengan kamera dan ekspor video.',
      },
    },
    ar: {
      controlsTitle: 'عناصر التحكم',
      exportClipsTitle: 'مشاركة وتصدير — المقاطع',
      exportTitle: 'مشاركة وتصدير',
      requirementsTitle: 'متطلبات النظام',
      creditsTitle: 'الاعتمادات',
      previousPage: 'الصفحة السابقة',
      nextPage: 'الصفحة التالية',
      gestureControls: 'التحكم بالإيماءات',
      credits: {
        line1: 'Lorenz Clash — تجربة WebGPU أنت جزء منها.',
        line2: 'صنعها André Frélicot.',
        date: 'يونيو 2026',
        privacyTitle: 'الخصوصية',
        privacyLine1:
          'كل شيء يعمل على جهازك. الكاميرا والصور والفيديوهات لا تغادره أبدًا — لا توجد خدمة خلفية.',
        privacyLine2:
          'إحصاءات جمهور فقط: عدّ زيارات مجهول، بلا cookies أو تتبع IP أو بيانات شخصية.',
      },
      items: {
        shapeName: 'الشكل',
        shapeDesc: 'غيّر شكل البطاقة: مسطح → مكعب → كرة.',
        trailName: 'الأثر',
        trailDesc: 'اتبع أثر المنحنى A → B.',
        viewName: 'العرض',
        viewDesc: 'بدّل الكاميرا: مدار حر → اتبع A → اتبع B.',
        snapshotName: 'لقطة',
        snapshotDesc: 'سجّل 5 ثوانٍ من العرض الحي. يتم أيضًا جمع الظهورات الخلفية تلقائيًا.',
        musicName: 'الموسيقى',
        musicDesc: 'بدّل الصوت أو الصمت — الموسيقى تقود المرئيات دائمًا.',
        splitName: 'تقسيم',
        splitDesc: 'المنحنى A يستخدم الكاميرا، والمنحنى B يستخدم مادة اصطناعية.',
        cameraName: 'الكاميرا',
        cameraDesc: 'شغّل أو أوقف الكاميرا الحية كمادة بصرية.',
        exportName: 'تصدير',
        exportDesc: 'عاين المقاطع، أعد ترتيبها، اختر الصوت، ثم أنشئ فيديو.',
        trackName: 'مقطع',
        trackDesc: 'انتقل إلى المقطع الموسيقي التالي.',
        frameName: 'الإطار',
        frameDesc: 'افتح منزلقًا لتعديل تأطير العرض الحر.',
        speedName: 'السرعة',
        speedDesc: 'افتح لوحة XY لضبط السرعة. النقر المزدوج يعيد القيم الافتراضية.',
        autoName: 'تلقائي',
        autoDesc: 'مخرج تلقائي — يبدّل الكاميرا والأشكال مع الموسيقى.',
        slowmoName: 'تصوير بطيء',
        slowmoDesc: 'اضغط مطولًا ثم اسحب — اسحب لأسفل لإبطاء الزمن والموسيقى.',
        pinchName: 'تكبير',
        pinchDesc: 'باعد بين إصبعين للتكبير؛ يعود عند الإفلات.',
        clipsName: 'المقاطع',
        clipsDesc: 'تتجمع اللقطات والظهورات التلقائية هنا. اسحب لإعادة الترتيب.',
        includeName: 'تضمين',
        includeDesc: 'حدد إن كان المقطع يدخل في الفيديو المصدر.',
        keepName: 'احتفاظ',
        keepDesc: 'ضع نجمة على المقطع حتى لا يُحذف تلقائيًا.',
        deleteName: 'حذف',
        deleteDesc: 'احذف مقطعًا واحدًا أو كل المقاطع غير المحفوظة.',
        soundName: 'الصوت',
        soundDesc: 'ضمّن الموسيقى. متزامن = كل مقطع يحتفظ بلحظته؛ مستمر = مسار واحد.',
        generateName: 'إنشاء',
        generateDesc: 'اعرض المقاطع في فيديو واحد، ثم نزّله أو شاركه.',
        deviceLimitsName: 'حدود الجهاز',
        deviceLimitsDesc: 'تتكيّف دقة التصدير ومعدل الإطارات مع ذاكرة الجهاز.',
        browserName: 'المتصفح',
        browserDesc:
          'يتطلب Lorenz Clash WebGPU واتصال HTTPS آمنًا. يوفّر Safari WebGPU على macOS Tahoe 26+ و iOS/iPadOS 26+ و visionOS 26+.',
        recommendedName: 'موصى به',
        recommendedDesc:
          'Chrome/Edge حديث على سطح المكتب، أو هاتف Android رائد حديث أو فئة متوسطة عليا مع Chrome على Android 12+، أو Safari 26 على نظام Apple مدعوم.',
        olderDevicesName: 'الأجهزة القديمة',
        olderDevicesDesc:
          'Safari 26 على macOS Sequoia/Sonoma لا يوفّر WebGPU؛ استخدم Chrome/Edge هناك. يختلف أداء Android كثيرًا، خصوصًا مع الكاميرا وتصدير الفيديو.',
      },
    },
    ru: {
      controlsTitle: 'Управление',
      exportClipsTitle: 'Поделиться и экспорт — клипы',
      exportTitle: 'Поделиться и экспорт',
      requirementsTitle: 'Системные требования',
      creditsTitle: 'Кредиты',
      previousPage: 'Предыдущая страница',
      nextPage: 'Следующая страница',
      gestureControls: 'Жесты',
      credits: {
        line1: 'Lorenz Clash — WebGPU-опыт, частью которого вы становитесь.',
        line2: 'Создано André Frélicot.',
        date: 'Июнь 2026',
        privacyTitle: 'Приватность',
        privacyLine1:
          'Всё работает на вашем устройстве. Камера, фото и видео не покидают его — backend отсутствует.',
        privacyLine2:
          'Только анонимный подсчёт посещений, без cookies, IP-трекинга и персональных данных.',
      },
      items: {
        shapeName: 'Форма',
        shapeDesc: 'Меняет форму карточки: плоскость → куб → сфера.',
        trailName: 'След',
        trailDesc: 'Следует за следом кривой A → B.',
        viewName: 'Вид',
        viewDesc: 'Переключает камеру: свободная орбита → следить A → следить B.',
        snapshotName: 'Снимок',
        snapshotDesc:
          'Записывает 5 секунд live-вида. Фоновые появления также собираются автоматически.',
        musicName: 'Музыка',
        musicDesc: 'Звук или без звука — музыка всегда управляет визуалом.',
        splitName: 'Разделение',
        splitDesc: 'Кривая A использует камеру, кривая B — синтетическую материю.',
        cameraName: 'Камера',
        cameraDesc: 'Включает или выключает live-камеру как визуальный материал.',
        exportName: 'Экспорт',
        exportDesc: 'Просмотр клипов, порядок, звук и создание видео.',
        trackName: 'Трек',
        trackDesc: 'Переход к следующему музыкальному треку.',
        frameName: 'Кадр',
        frameDesc: 'Открывает фейдер для кадрирования свободного вида.',
        speedName: 'Скорость',
        speedDesc: 'Открывает XY-пад для скорости. Двойной клик/тап сбрасывает значения.',
        autoName: 'Авто',
        autoDesc: 'Автоматический режиссёр — меняет камеру и формы в такт музыке.',
        slowmoName: 'Слоу-мо',
        slowmoDesc: 'Нажмите и тяните — вниз замедляет время и музыку.',
        pinchName: 'Развести пальцы',
        pinchDesc: 'Разведите два пальца для зума; отпустите, чтобы вернуться.',
        clipsName: 'Клипы',
        clipsDesc: 'Снимки и авто-появления собираются здесь. Перетаскивайте для сортировки.',
        includeName: 'Включить',
        includeDesc: 'Включить клип в экспортируемое видео.',
        keepName: 'Сохранить',
        keepDesc: 'Пометьте клип, чтобы он не удалялся автоматически.',
        deleteName: 'Удалить',
        deleteDesc: 'Удалить один клип или все несохранённые.',
        soundName: 'Звук',
        soundDesc:
          'Включить музыку. Синхронно = каждый клип сохраняет момент; Непрерывно = один трек.',
        generateName: 'Создать',
        generateDesc: 'Собрать клипы в одно видео, затем скачать или поделиться.',
        deviceLimitsName: 'Ограничения устройства',
        deviceLimitsDesc: 'Разрешение и fps экспорта подстраиваются под память устройства.',
        browserName: 'Браузер',
        browserDesc:
          'Lorenz Clash требует WebGPU и безопасное HTTPS-соединение. Safari предоставляет WebGPU на macOS Tahoe 26+, iOS/iPadOS 26+ и visionOS 26+.',
        recommendedName: 'Рекомендуется',
        recommendedDesc:
          'Свежий Chrome/Edge на desktop, свежий Android-флагман или производительный верхний средний класс с Chrome на Android 12+, либо Safari 26 на поддерживаемой Apple OS.',
        olderDevicesName: 'Старые устройства',
        olderDevicesDesc:
          'Safari 26 на macOS Sequoia/Sonoma не предоставляет WebGPU; используйте там Chrome/Edge. Производительность Android сильно различается, особенно с камерой и экспортом видео.',
      },
    },
    it: {
      controlsTitle: 'Controlli',
      exportClipsTitle: 'Condividi ed esporta — Clip',
      exportTitle: 'Condividi ed esporta',
      requirementsTitle: 'Requisiti di sistema',
      creditsTitle: 'Crediti',
      previousPage: 'Pagina precedente',
      nextPage: 'Pagina successiva',
      gestureControls: 'Controlli gestuali',
      credits: {
        line1: 'Lorenz Clash — un’esperienza WebGPU di cui fai parte.',
        line2: 'Creato da André Frélicot.',
        date: 'Giugno 2026',
        privacyTitle: 'Privacy',
        privacyLine1:
          'Tutto gira sul tuo dispositivo. Fotocamera, foto e video non lo lasciano mai — nessun backend.',
        privacyLine2:
          'Solo conteggi anonimi delle visite, senza cookies, tracciamento IP o dati personali.',
      },
      items: {
        shapeName: 'Forma',
        shapeDesc: 'Cambia forma: piano → cubo → sfera.',
        trailName: 'Scia',
        trailDesc: 'Segue la scia della curva A → B.',
        viewName: 'Vista',
        viewDesc: 'Cambia vista: orbita libera → segui A → segui B.',
        snapshotName: 'Snapshot',
        snapshotDesc:
          'Registra 5 secondi della vista live. Anche le apparizioni di sfondo vengono raccolte automaticamente.',
        musicName: 'Musica',
        musicDesc: 'Suono o muto — la musica guida sempre i visual.',
        splitName: 'Divisione',
        splitDesc: 'La curva A usa la fotocamera, la B materia sintetica.',
        cameraName: 'Fotocamera',
        cameraDesc: 'Attiva o disattiva la fotocamera live come materiale visivo.',
        exportName: 'Esporta',
        exportDesc: 'Anteprima, riordino, scelta audio e creazione video.',
        trackName: 'Brano',
        trackDesc: 'Passa al brano successivo.',
        frameName: 'Inquadratura',
        frameDesc: 'Apre un fader per stringere o allargare la vista libera.',
        speedName: 'Velocità',
        speedDesc: 'Apre un pad XY per la velocità. Doppio clic/tap ripristina i default.',
        autoName: 'Auto',
        autoDesc: 'Regia automatica — cambia camera e forme a tempo di musica.',
        slowmoName: 'Slow-mo',
        slowmoDesc: 'Tieni premuto e trascina — verso il basso rallenta tempo e musica.',
        pinchName: 'Pinch out',
        pinchDesc: 'Allarga due dita per zoomare; torna indietro al rilascio.',
        clipsName: 'Clip',
        clipsDesc: 'Snapshot e apparizioni automatiche arrivano qui. Trascina per riordinare.',
        includeName: 'Includi',
        includeDesc: 'Sceglie se la clip entra nel video esportato.',
        keepName: 'Tieni',
        keepDesc: 'Segna una clip per non eliminarla automaticamente.',
        deleteName: 'Elimina',
        deleteDesc: 'Elimina una clip o tutte quelle non tenute.',
        soundName: 'Audio',
        soundDesc:
          'Include la musica. Sincrono = ogni clip mantiene il suo momento; Continuo = una traccia.',
        generateName: 'Genera',
        generateDesc: 'Renderizza le clip in un video, poi scarica o condividi.',
        deviceLimitsName: 'Limiti dispositivo',
        deviceLimitsDesc: 'Risoluzione e fps di export si adattano alla memoria.',
        browserName: 'Browser',
        browserDesc:
          'Lorenz Clash richiede WebGPU e una connessione HTTPS sicura. Safari espone WebGPU su macOS Tahoe 26+, iOS/iPadOS 26+ e visionOS 26+.',
        recommendedName: 'Consigliato',
        recommendedDesc:
          'Chrome/Edge recente su desktop, Android flagship recente o upper-midrange orientato alle prestazioni con Chrome su Android 12+, oppure Safari 26 su un OS Apple supportato.',
        olderDevicesName: 'Dispositivi vecchi',
        olderDevicesDesc:
          'Safari 26 su macOS Sequoia/Sonoma non espone WebGPU; lì usa Chrome/Edge. Le prestazioni Android variano molto, soprattutto con fotocamera ed export video.',
      },
    },
    tr: {
      controlsTitle: 'Kontroller',
      exportClipsTitle: 'Paylaş ve dışa aktar — Klipler',
      exportTitle: 'Paylaş ve dışa aktar',
      requirementsTitle: 'Sistem gereksinimleri',
      creditsTitle: 'Krediler',
      previousPage: 'Önceki sayfa',
      nextPage: 'Sonraki sayfa',
      gestureControls: 'Jest kontrolleri',
      credits: {
        line1: 'Lorenz Clash — parçası olduğunuz bir WebGPU deneyimi.',
        line2: 'André Frélicot tarafından yaratıldı.',
        date: 'Haziran 2026',
        privacyTitle: 'Gizlilik',
        privacyLine1:
          'Her şey cihazınızda çalışır. Kamera, fotoğraf ve videolar cihazdan çıkmaz — backend yok.',
        privacyLine2: 'Yalnızca anonim ziyaret sayımı; cookies, IP takibi veya kişisel veri yok.',
      },
      items: {
        shapeName: 'Şekil',
        shapeDesc: 'Kart şeklini değiştir: düzlem → küp → küre.',
        trailName: 'İz',
        trailDesc: 'A → B eğrisinin izini takip eder.',
        viewName: 'Görünüm',
        viewDesc: 'Kamerayı değiştir: serbest orbit → A takip → B takip.',
        snapshotName: 'Kayıt',
        snapshotDesc: 'Canlı görünümden 5 saniye kaydeder. Arka plan anları da otomatik toplanır.',
        musicName: 'Müzik',
        musicDesc: 'Ses veya sessiz — müzik görselleri her zaman sürer.',
        splitName: 'Bölme',
        splitDesc: 'A eğrisi kamerayı, B eğrisi sentetik maddeyi kullanır.',
        cameraName: 'Kamera',
        cameraDesc: 'Canlı kamerayı görsel malzeme olarak açar veya kapatır.',
        exportName: 'Dışa aktar',
        exportDesc: 'Klipleri önizle, sırala, sesi seç ve video oluştur.',
        trackName: 'Parça',
        trackDesc: 'Sonraki müzik parçasına geçer.',
        frameName: 'Kadraj',
        frameDesc: 'Serbest görünüm kadrajını ayarlamak için fader açar.',
        speedName: 'Hız',
        speedDesc: 'Hızı ayarlamak için XY pad açar. Çift tık/dokunma varsayılana döner.',
        autoName: 'Auto',
        autoDesc: 'Otomatik yönetmen — kamera ve şekilleri müzikle değiştirir.',
        slowmoName: 'Slow-mo',
        slowmoDesc: 'Basılı tutup sürükle — aşağı çekmek zamanı ve müziği yavaşlatır.',
        pinchName: 'Pinch out',
        pinchDesc: 'Yakınlaşmak için iki parmağı aç; bırakınca geri döner.',
        clipsName: 'Klipler',
        clipsDesc: 'Kayıtlar ve otomatik anlar burada toplanır. Sıralamak için sürükle.',
        includeName: 'Dahil et',
        includeDesc: 'Klibin dışa aktarılan videoya girip girmeyeceğini seçer.',
        keepName: 'Sakla',
        keepDesc: 'Klibi yıldızla; otomatik silinmez.',
        deleteName: 'Sil',
        deleteDesc: 'Tek klibi veya saklanmayan klipleri siler.',
        soundName: 'Ses',
        soundDesc: 'Müziği dahil et. Senkron = her klip kendi anını tutar; Sürekli = tek parça.',
        generateName: 'Oluştur',
        generateDesc: 'Klipleri tek videoya render edip indir veya paylaş.',
        deviceLimitsName: 'Cihaz sınırları',
        deviceLimitsDesc: 'Export çözünürlüğü ve fps cihaz belleğine uyarlanır.',
        browserName: 'Tarayıcı',
        browserDesc:
          'Lorenz Clash için WebGPU ve güvenli HTTPS bağlantısı gerekir. Safari, WebGPU’yu macOS Tahoe 26+, iOS/iPadOS 26+ ve visionOS 26+ üzerinde sunar.',
        recommendedName: 'Önerilen',
        recommendedDesc:
          'Desktop üzerinde güncel Chrome/Edge, Android 12+ Chrome kullanan yeni Android amiral gemisi veya performans odaklı üst-orta segment telefon ya da desteklenen Apple OS üzerinde Safari 26.',
        olderDevicesName: 'Eski cihazlar',
        olderDevicesDesc:
          'macOS Sequoia/Sonoma’daki Safari 26 WebGPU sunmaz; bu OS’lerde Chrome/Edge kullanın. Android performansı özellikle kamera ve video dışa aktarmada çok değişkendir.',
      },
    },
    bn: {
      controlsTitle: 'নিয়ন্ত্রণ',
      exportClipsTitle: 'শেয়ার ও রপ্তানি — ক্লিপ',
      exportTitle: 'শেয়ার ও রপ্তানি',
      requirementsTitle: 'সিস্টেম প্রয়োজনীয়তা',
      creditsTitle: 'স্বীকৃতি',
      previousPage: 'আগের পৃষ্ঠা',
      nextPage: 'পরের পৃষ্ঠা',
      gestureControls: 'ইঙ্গিতভিত্তিক নিয়ন্ত্রণ',
      credits: {
        line1: 'Lorenz Clash — একটি WebGPU অভিজ্ঞতা, যার অংশ আপনি।',
        line2: 'তৈরি করেছেন André Frélicot।',
        date: 'জুন ২০২৬',
        privacyTitle: 'গোপনীয়তা',
        privacyLine1:
          'সবকিছু আপনার ডিভাইসে চলে। ক্যামেরা, ছবি ও ভিডিও কখনও বাইরে যায় না — কোনো সার্ভার-পক্ষ নেই।',
        privacyLine2: 'শুধু অজ্ঞাত দর্শন গণনা; কুকি, IP অনুসরণ বা ব্যক্তিগত ডেটা নেই।',
      },
      items: {
        shapeName: 'আকার',
        shapeDesc: 'কার্ডের আকার বদলান: সমতল → ঘনক → গোলক।',
        trailName: 'পথরেখা',
        trailDesc: 'বক্ররেখা A → B-এর পথরেখা অনুসরণ করে।',
        viewName: 'দৃশ্য',
        viewDesc: 'ক্যামেরা বদলান: মুক্ত কক্ষপথ → A অনুসরণ → B অনুসরণ।',
        snapshotName: 'রেকর্ড',
        snapshotDesc:
          'সরাসরি দৃশ্য ৫ সেকেন্ড রেকর্ড করে। পটভূমির মুহূর্তও স্বয়ংক্রিয়ভাবে সংগ্রহ হয়।',
        musicName: 'সঙ্গীত',
        musicDesc: 'শব্দ বা নিঃশব্দ — সঙ্গীত সবসময় দৃশ্য চালায়।',
        splitName: 'বিভাজন',
        splitDesc: 'বক্ররেখা A ক্যামেরা রাখে, বক্ররেখা B কৃত্রিম উপাদান ব্যবহার করে।',
        cameraName: 'ক্যামেরা',
        cameraDesc: 'সরাসরি ক্যামেরাকে দৃশ্যের উপাদান হিসেবে চালু বা বন্ধ করে।',
        exportName: 'রপ্তানি',
        exportDesc: 'ক্লিপ দেখে নিন, সাজান, শব্দ বেছে নিন, তারপর ভিডিও বানান।',
        trackName: 'ট্র্যাক',
        trackDesc: 'পরের সঙ্গীত ট্র্যাকে যান।',
        frameName: 'ফ্রেম',
        frameDesc: 'মুক্ত দৃশ্যের ফ্রেমিং টানটান বা ঢিলা করতে ফেডার খুলুন।',
        speedName: 'গতি',
        speedDesc:
          'প্রতিটি বক্ররেখার গতি ঠিক করতে XY প্যাড খুলুন। ডাবল-ক্লিক বা ডাবল-ট্যাপে ডিফল্টে ফেরে।',
        autoName: 'স্বয়ংক্রিয়',
        autoDesc: 'স্বয়ংক্রিয় পরিচালক — সঙ্গীতের সাথে ক্যামেরা ও আকার বদলায়।',
        slowmoName: 'স্লো-মো',
        slowmoDesc: 'চেপে ধরে টানুন — নিচে টানলে সময় ও সঙ্গীত ধীর হয়।',
        pinchName: 'আঙুল ছড়ান',
        pinchDesc: 'জুম করতে দুই আঙুল ছড়ান; ছেড়ে দিলে ফিরে আসে।',
        clipsName: 'ক্লিপ',
        clipsDesc: 'রেকর্ড ও স্বয়ংক্রিয় মুহূর্ত এখানে জমে। সাজাতে টেনে নিন।',
        includeName: 'অন্তর্ভুক্ত',
        includeDesc: 'ক্লিপটি রপ্তানি করা ভিডিওতে থাকবে কি না বেছে নিন।',
        keepName: 'রাখুন',
        keepDesc: 'ক্লিপে তারকা দিলে তা স্বয়ংক্রিয়ভাবে মুছে যাবে না।',
        deleteName: 'মুছুন',
        deleteDesc: 'একটি ক্লিপ বা না-রাখা সব ক্লিপ মুছুন।',
        soundName: 'শব্দ',
        soundDesc:
          'সঙ্গীত অন্তর্ভুক্ত করুন। সামঞ্জস্য = প্রতিটি ক্লিপ নিজের সময় রাখে; ধারাবাহিক = একটানা ট্র্যাক।',
        generateName: 'বানান',
        generateDesc: 'ক্লিপগুলো এক ভিডিওতে রেন্ডার করে ডাউনলোড বা শেয়ার করুন।',
        deviceLimitsName: 'ডিভাইস সীমা',
        deviceLimitsDesc: 'রপ্তানির রেজোলিউশন ও fps ডিভাইসের মেমরি অনুযায়ী বদলায়।',
        browserName: 'ব্রাউজার',
        browserDesc:
          'Lorenz Clash-এর জন্য WebGPU এবং নিরাপদ HTTPS সংযোগ দরকার। Safari macOS Tahoe 26+, iOS/iPadOS 26+ এবং visionOS 26+ এ WebGPU প্রকাশ করে।',
        recommendedName: 'প্রস্তাবিত',
        recommendedDesc:
          'ডেস্কটপে নতুন Chrome/Edge, Android 12+ Chrome চালানো সাম্প্রতিক Android ফ্ল্যাগশিপ বা পারফরম্যান্স-কেন্দ্রিক upper-midrange ফোন, অথবা সমর্থিত Apple OS-এ Safari 26।',
        olderDevicesName: 'পুরোনো ডিভাইস',
        olderDevicesDesc:
          'macOS Sequoia/Sonoma-এ Safari 26 WebGPU প্রকাশ করে না; সেখানে Chrome/Edge ব্যবহার করুন। Android পারফরম্যান্স বিশেষ করে ক্যামেরা ও ভিডিও রপ্তানিতে অনেক ভিন্ন হতে পারে।',
      },
    },
  };
  const t = tables[locale];
  return {
    ...base,
    ...t,
    credits: { ...base.credits, ...t.credits },
    items: { ...base.items, ...t.items },
  };
}

function russianClipPhrase(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'несохранённый клип';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'несохранённых клипа';
  }
  return 'несохранённых клипов';
}

function makeTranslatedExport(locale: CompactLocale): Translation['exportMenu'] {
  const tables: Record<CompactLocale, Partial<Translation['exportMenu']>> = {
    de: {
      title: 'Teilen & Export',
      empty: 'Lass den Hintergrundmodus laufen oder tippe Snapshot 5s — Clips erscheinen hier.',
      synced: 'Synchron',
      syncedTitle: 'Jeder Clip behält die Musik aus seinem Moment',
      continuous: 'Kontinuierlich',
      continuousTitle: 'Ein durchgehender Track ab dem ersten Clip',
      includeSound: 'Sound einbeziehen',
      sound: 'Sound',
      exportDuration: (duration) => `Videolänge: ${duration}`,
      clearUnkeptLabel: (n) => `Nicht markierte löschen (${n})`,
      clearUnkeptConfirm: (n) =>
        n === 1
          ? '1 nicht markierten Clip löschen? Markierte Clips bleiben.'
          : `${n} nicht markierte Clips löschen? Markierte Clips bleiben.`,
      generateVideo: 'Video erzeugen',
      generated: 'Erzeugt ✓',
      generating: 'Erzeuge…',
      failedRetry: 'Export fehlgeschlagen — erneut versuchen',
      dragToReorder: 'Ziehen zum Sortieren',
      included: 'Im Export enthalten — tippen zum Ausschließen',
      excluded: 'Ausgeschlossen — tippen zum Einbeziehen',
      kept: 'Behalten — tippen für Auto-Löschen',
      keep: 'Tippen zum Behalten (nie auto-gelöscht)',
      deleteClip: 'Diesen Clip löschen',
      deleteClipConfirm: 'Diesen Clip löschen?',
    },
    es: {
      title: 'Compartir y exportar',
      empty: 'Deja correr el modo de fondo o toca Captura 5s — cada clip aparece aquí.',
      synced: 'Sincronizado',
      syncedTitle: 'Cada clip conserva la música de su momento',
      continuous: 'Continuo',
      continuousTitle: 'Una pista continua desde el primer clip',
      includeSound: 'Incluir sonido',
      sound: 'Sonido',
      exportDuration: (duration) => `Duración del video: ${duration}`,
      clearUnkeptLabel: (n) => `Borrar no guardados (${n})`,
      clearUnkeptConfirm: (n) =>
        `¿Borrar ${n} clip${n > 1 ? 's' : ''} no guardado${n > 1 ? 's' : ''}? Solo quedan los marcados.`,
      generateVideo: 'Generar video',
      generated: 'Generado ✓',
      generating: 'Generando…',
      failedRetry: 'Exportación fallida — reintentar',
      dragToReorder: 'Arrastra para reordenar',
      included: 'Incluido en exportación — toca para excluir',
      excluded: 'Excluido — toca para incluir',
      kept: 'Guardado — toca para permitir auto-borrado',
      keep: 'Toca para guardar (nunca auto-borrado)',
      deleteClip: 'Eliminar este clip',
      deleteClipConfirm: '¿Eliminar este clip?',
    },
    'pt-BR': {
      title: 'Compartilhar e exportar',
      empty: 'Deixe o modo de fundo rodar ou toque Captura 5s — cada clipe aparece aqui.',
      synced: 'Sincronizado',
      syncedTitle: 'Cada clipe mantém a música do seu momento',
      continuous: 'Contínuo',
      continuousTitle: 'Uma faixa contínua desde o primeiro clipe',
      includeSound: 'Incluir som',
      sound: 'Som',
      exportDuration: (duration) => `Duração do vídeo: ${duration}`,
      clearUnkeptLabel: (n) => `Limpar não mantidos (${n})`,
      clearUnkeptConfirm: (n) =>
        `Excluir ${n} clipe${n > 1 ? 's' : ''} não mantido${n > 1 ? 's' : ''}? Só os marcados ficam.`,
      generateVideo: 'Gerar vídeo',
      generated: 'Gerado ✓',
      generating: 'Gerando…',
      failedRetry: 'Export falhou — tentar de novo',
      dragToReorder: 'Arraste para reordenar',
      included: 'Incluído no export — toque para excluir',
      excluded: 'Excluído — toque para incluir',
      kept: 'Mantido — toque para permitir auto-exclusão',
      keep: 'Toque para manter (nunca auto-excluído)',
      deleteClip: 'Excluir este clipe',
      deleteClipConfirm: 'Excluir este clipe?',
    },
    ja: {
      title: '共有と書き出し',
      empty: '背景モードを動かすか「5秒録画」をタップすると、クリップがここに表示されます。',
      synced: '同期',
      syncedTitle: '各クリップが録画時の音楽を保持します',
      continuous: '連続',
      continuousTitle: '最初のクリップから1本の曲として再生',
      includeSound: '音を含める',
      sound: '音',
      exportDuration: (duration) => `動画の長さ: ${duration}`,
      clearUnkeptLabel: (n) => `未保持を削除 (${n})`,
      clearUnkeptConfirm: (n) =>
        `未保持クリップ ${n} 件を削除しますか？保持したクリップは残ります。`,
      generateVideo: '動画を生成',
      generated: '生成済み ✓',
      generating: '生成中…',
      failedRetry: '書き出し失敗 — 再試行',
      dragToReorder: 'ドラッグで並べ替え',
      included: '書き出しに含む — タップで除外',
      excluded: '除外中 — タップで含める',
      kept: '保持中 — タップで自動削除を許可',
      keep: '保持する（自動削除されません）',
      deleteClip: 'このクリップを削除',
      deleteClipConfirm: 'このクリップを削除しますか？',
    },
    ko: {
      title: '공유 및 내보내기',
      empty: '배경 모드를 실행하거나 5초 캡처를 누르면 클립이 여기에 나타납니다.',
      synced: '동기화',
      syncedTitle: '각 클립이 녹화 당시의 음악을 유지합니다',
      continuous: '연속',
      continuousTitle: '첫 클립부터 하나의 연속 트랙',
      includeSound: '사운드 포함',
      sound: '사운드',
      exportDuration: (duration) => `영상 길이: ${duration}`,
      clearUnkeptLabel: (n) => `미보관 삭제 (${n})`,
      clearUnkeptConfirm: (n) => `보관하지 않은 클립 ${n}개를 삭제할까요? 보관 클립만 남습니다.`,
      generateVideo: '영상 생성',
      generated: '생성됨 ✓',
      generating: '생성 중…',
      failedRetry: '내보내기 실패 — 재시도',
      dragToReorder: '드래그로 정렬',
      included: '내보내기에 포함 — 탭해서 제외',
      excluded: '제외됨 — 탭해서 포함',
      kept: '보관됨 — 탭해서 자동 삭제 허용',
      keep: '보관하기 (자동 삭제 안 됨)',
      deleteClip: '이 클립 삭제',
      deleteClipConfirm: '이 클립을 삭제할까요?',
    },
    'zh-Hans': {
      title: '分享与导出',
      empty: '让背景模式运行，或点按“录制 5秒” — 每个片段都会出现在这里。',
      synced: '同步',
      syncedTitle: '每个片段保留录制时的音乐',
      continuous: '连续',
      continuousTitle: '从第一个片段开始的一条连续曲目',
      includeSound: '包含声音',
      sound: '声音',
      exportDuration: (duration) => `视频时长：${duration}`,
      clearUnkeptLabel: (n) => `清除未保留 (${n})`,
      clearUnkeptConfirm: (n) => `清除 ${n} 个未保留片段？已标记保留的片段会留下。`,
      generateVideo: '生成视频',
      generated: '已生成 ✓',
      generating: '生成中…',
      failedRetry: '导出失败 — 重试',
      dragToReorder: '拖动排序',
      included: '已包含在导出中 — 点按排除',
      excluded: '已排除 — 点按包含',
      kept: '已保留 — 点按允许自动删除',
      keep: '点按保留（不会自动删除）',
      deleteClip: '删除此片段',
      deleteClipConfirm: '删除此片段？',
    },
    th: {
      title: 'แชร์และส่งออก',
      empty: 'ปล่อยให้โหมดพื้นหลังทำงาน หรือแตะ บันทึก 5วิ — คลิปจะปรากฏที่นี่',
      synced: 'ซิงก์',
      syncedTitle: 'แต่ละคลิปเก็บเพลงจากช่วงเวลานั้น',
      continuous: 'ต่อเนื่อง',
      continuousTitle: 'เพลงต่อเนื่องจากคลิปแรก',
      includeSound: 'รวมเสียง',
      sound: 'เสียง',
      exportDuration: (duration) => `ความยาววิดีโอ: ${duration}`,
      clearUnkeptLabel: (n) => `ลบที่ไม่เก็บ (${n})`,
      clearUnkeptConfirm: (n) => `ลบคลิปที่ไม่เก็บ ${n} คลิป? คลิปที่ปักดาวจะยังอยู่`,
      generateVideo: 'สร้างวิดีโอ',
      generated: 'สร้างแล้ว ✓',
      generating: 'กำลังสร้าง…',
      failedRetry: 'ส่งออกล้มเหลว — ลองใหม่',
      dragToReorder: 'ลากเพื่อจัดลำดับ',
      included: 'รวมในการส่งออก — แตะเพื่อเอาออก',
      excluded: 'ไม่รวม — แตะเพื่อรวม',
      kept: 'เก็บไว้ — แตะเพื่อให้ลบอัตโนมัติได้',
      keep: 'แตะเพื่อเก็บไว้ (ไม่ลบอัตโนมัติ)',
      deleteClip: 'ลบคลิปนี้',
      deleteClipConfirm: 'ลบคลิปนี้?',
    },
    hi: {
      title: 'शेयर और निर्यात',
      empty: 'पृष्ठभूमि मोड चलने दें, या 5 सेकंड रिकॉर्ड टैप करें — हर क्लिप यहाँ दिखेगी।',
      synced: 'सिंक्रनाइज़',
      syncedTitle: 'हर क्लिप अपने क्षण का संगीत रखती है',
      continuous: 'निरंतर',
      continuousTitle: 'पहली क्लिप से एक लगातार ट्रैक',
      includeSound: 'ध्वनि शामिल करें',
      sound: 'ध्वनि',
      exportDuration: (duration) => `वीडियो अवधि: ${duration}`,
      clearUnkeptLabel: (n) => `न रखे गए हटाएँ (${n})`,
      clearUnkeptConfirm: (n) => `${n} न रखे गए क्लिप हटाएँ? तारांकित क्लिप रहेंगे।`,
      generateVideo: 'वीडियो बनाएँ',
      generated: 'बन गया ✓',
      generating: 'बन रहा है…',
      failedRetry: 'निर्यात विफल — फिर कोशिश करें',
      dragToReorder: 'क्रम बदलने के लिए खींचें',
      included: 'निर्यात में शामिल — बाहर करने के लिए टैप करें',
      excluded: 'बाहर — शामिल करने के लिए टैप करें',
      kept: 'रखा गया — अपने आप मिटाने की अनुमति देने के लिए टैप करें',
      keep: 'रखने के लिए टैप करें (अपने आप नहीं मिटेगा)',
      deleteClip: 'यह क्लिप हटाएँ',
      deleteClipConfirm: 'यह क्लिप हटाएँ?',
    },
    id: {
      title: 'Bagikan & Ekspor',
      empty: 'Biarkan mode latar berjalan, atau ketuk Snapshot 5d — tiap klip muncul di sini.',
      synced: 'Sinkron',
      syncedTitle: 'Setiap klip menyimpan musik pada momennya',
      continuous: 'Kontinu',
      continuousTitle: 'Satu track utuh dari klip pertama',
      includeSound: 'Sertakan suara',
      sound: 'Suara',
      exportDuration: (duration) => `Durasi video: ${duration}`,
      clearUnkeptLabel: (n) => `Hapus yang tidak disimpan (${n})`,
      clearUnkeptConfirm: (n) => `Hapus ${n} klip yang tidak disimpan? Klip berbintang tetap ada.`,
      generateVideo: 'Buat Video',
      generated: 'Selesai ✓',
      generating: 'Membuat…',
      failedRetry: 'Ekspor gagal — coba lagi',
      dragToReorder: 'Seret untuk menyusun ulang',
      included: 'Disertakan dalam ekspor — ketuk untuk mengecualikan',
      excluded: 'Dikecualikan — ketuk untuk menyertakan',
      kept: 'Disimpan — ketuk untuk mengizinkan hapus otomatis',
      keep: 'Ketuk untuk menyimpan (tidak dihapus otomatis)',
      deleteClip: 'Hapus klip ini',
      deleteClipConfirm: 'Hapus klip ini?',
    },
    ar: {
      title: 'مشاركة وتصدير',
      empty: 'اترك وضع الخلفية يعمل، أو اضغط لقطة 5 ث — سيظهر كل مقطع هنا.',
      synced: 'متزامن',
      syncedTitle: 'كل مقطع يحتفظ بالموسيقى التي شُغّلت أثناءه',
      continuous: 'مستمر',
      continuousTitle: 'مسار واحد مستمر من أول مقطع',
      includeSound: 'تضمين الصوت',
      sound: 'الصوت',
      exportDuration: (duration) => `مدة الفيديو: ${duration}`,
      clearUnkeptLabel: (n) => `حذف غير المحفوظ (${n})`,
      clearUnkeptConfirm: (n) => `حذف ${n} مقطع غير محفوظ؟ تبقى المقاطع ذات النجمة فقط.`,
      generateVideo: 'إنشاء فيديو',
      generated: 'تم الإنشاء ✓',
      generating: 'جارٍ الإنشاء…',
      failedRetry: 'فشل التصدير — أعد المحاولة',
      dragToReorder: 'اسحب لإعادة الترتيب',
      included: 'مضمن في التصدير — اضغط للاستبعاد',
      excluded: 'مستبعد — اضغط للتضمين',
      kept: 'محفوظ — اضغط للسماح بالحذف التلقائي',
      keep: 'اضغط للاحتفاظ (لن يُحذف تلقائيًا)',
      deleteClip: 'حذف هذا المقطع',
      deleteClipConfirm: 'حذف هذا المقطع؟',
    },
    ru: {
      title: 'Поделиться и экспорт',
      empty: 'Оставьте фоновый режим работать или нажмите Снимок 5с — клипы появятся здесь.',
      synced: 'Синхронно',
      syncedTitle: 'Каждый клип сохраняет музыку своего момента',
      continuous: 'Непрерывно',
      continuousTitle: 'Один непрерывный трек с первого клипа',
      includeSound: 'Включить звук',
      sound: 'Звук',
      exportDuration: (duration) => `Длительность видео: ${duration}`,
      clearUnkeptLabel: (n) => `Удалить несохранённые (${n})`,
      clearUnkeptConfirm: (n) =>
        `Удалить ${n} ${russianClipPhrase(n)}? Помеченные клипы останутся.`,
      generateVideo: 'Создать видео',
      generated: 'Создано ✓',
      generating: 'Создание…',
      failedRetry: 'Экспорт не удался — повторить',
      dragToReorder: 'Перетащите для сортировки',
      included: 'Включено в экспорт — нажмите, чтобы исключить',
      excluded: 'Исключено — нажмите, чтобы включить',
      kept: 'Сохранено — нажмите, чтобы разрешить автоудаление',
      keep: 'Нажмите, чтобы сохранить (не удаляется автоматически)',
      deleteClip: 'Удалить этот клип',
      deleteClipConfirm: 'Удалить этот клип?',
    },
    it: {
      title: 'Condividi ed esporta',
      empty: 'Lascia girare lo sfondo o tocca Snapshot 5s — ogni clip appare qui.',
      synced: 'Sincrono',
      syncedTitle: 'Ogni clip mantiene la musica del suo momento',
      continuous: 'Continuo',
      continuousTitle: 'Una traccia continua dalla prima clip',
      includeSound: 'Includi audio',
      sound: 'Audio',
      exportDuration: (duration) => `Durata video: ${duration}`,
      clearUnkeptLabel: (n) => `Pulisci non tenute (${n})`,
      clearUnkeptConfirm: (n) =>
        `Eliminare ${n} clip non tenut${n > 1 ? 'e' : 'a'}? Restano solo quelle segnate.`,
      generateVideo: 'Genera video',
      generated: 'Generato ✓',
      generating: 'Generazione…',
      failedRetry: 'Esportazione fallita — riprova',
      dragToReorder: 'Trascina per riordinare',
      included: 'Inclusa nell’esportazione — tocca per escludere',
      excluded: 'Esclusa — tocca per includere',
      kept: 'Tenuta — tocca per consentire l’eliminazione automatica',
      keep: 'Tocca per tenere (mai eliminata automaticamente)',
      deleteClip: 'Elimina questa clip',
      deleteClipConfirm: 'Eliminare questa clip?',
    },
    tr: {
      title: 'Paylaş ve dışa aktar',
      empty: 'Arka plan modu çalışsın veya 5 sn kayıt düğmesine dokunun — klipler burada görünür.',
      synced: 'Senkron',
      syncedTitle: 'Her klip kendi anındaki müziği korur',
      continuous: 'Sürekli',
      continuousTitle: 'İlk klipten başlayan kesintisiz parça',
      includeSound: 'Sesi dahil et',
      sound: 'Ses',
      exportDuration: (duration) => `Video süresi: ${duration}`,
      clearUnkeptLabel: (n) => `Saklanmayanları temizle (${n})`,
      clearUnkeptConfirm: (n) => `${n} saklanmayan klip silinsin mi? Yıldızlı klipler kalır.`,
      generateVideo: 'Video oluştur',
      generated: 'Oluşturuldu ✓',
      generating: 'Oluşturuluyor…',
      failedRetry: 'Dışa aktarma başarısız — tekrar dene',
      dragToReorder: 'Sıralamak için sürükle',
      included: 'Dışa aktarmaya dahil — çıkarmak için dokun',
      excluded: 'Hariç — dahil etmek için dokun',
      kept: 'Saklandı — otomatik silmeye izin vermek için dokun',
      keep: 'Saklamak için dokun (otomatik silinmez)',
      deleteClip: 'Bu klibi sil',
      deleteClipConfirm: 'Bu klip silinsin mi?',
    },
    bn: {
      title: 'শেয়ার ও রপ্তানি',
      empty:
        'পটভূমি মোড চলতে দিন, অথবা ৫ সেকেন্ড রেকর্ড ট্যাপ করুন — প্রতিটি ক্লিপ এখানে দেখা যাবে।',
      synced: 'সামঞ্জস্য',
      syncedTitle: 'প্রতিটি ক্লিপ নিজের সময়ের সঙ্গীত রাখে',
      continuous: 'ধারাবাহিক',
      continuousTitle: 'প্রথম ক্লিপ থেকে একটানা ট্র্যাক',
      includeSound: 'শব্দ অন্তর্ভুক্ত',
      sound: 'শব্দ',
      exportDuration: (duration) => `ভিডিওর দৈর্ঘ্য: ${duration}`,
      clearUnkeptLabel: (n) => `না-রাখা মুছুন (${n})`,
      clearUnkeptConfirm: (n) => `${n} না-রাখা ক্লিপ মুছবেন? তারকা-চিহ্নিত ক্লিপ থাকবে।`,
      generateVideo: 'ভিডিও বানান',
      generated: 'বানানো হয়েছে ✓',
      generating: 'বানানো হচ্ছে…',
      failedRetry: 'রপ্তানি ব্যর্থ — আবার চেষ্টা করুন',
      dragToReorder: 'সাজাতে টেনে নিন',
      included: 'রপ্তানিতে আছে — বাদ দিতে ট্যাপ করুন',
      excluded: 'বাদ আছে — অন্তর্ভুক্ত করতে ট্যাপ করুন',
      kept: 'রাখা হয়েছে — স্বয়ংক্রিয় মুছে ফেলার অনুমতি দিতে ট্যাপ করুন',
      keep: 'রাখতে ট্যাপ করুন (স্বয়ংক্রিয়ভাবে মুছে যাবে না)',
      deleteClip: 'এই ক্লিপ মুছুন',
      deleteClipConfirm: 'এই ক্লিপ মুছবেন?',
    },
  };
  return { ...en.exportMenu, ...tables[locale] };
}

function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.translate = false;
  document.documentElement.classList.add('notranslate');
  document.body?.setAttribute('translate', 'no');
}

export function normalizeLocale(input: string | null | undefined): Locale | null {
  if (!input) return null;
  const raw = input.replace('_', '-').trim();
  const lower = raw.toLowerCase();
  if (lower === 'pt-br' || lower === 'pt') return 'pt-BR';
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh-hans')
    return 'zh-Hans';
  const primary = lower.split('-')[0];
  if (primary === 'en') return 'en';
  if (primary === 'fr') return 'fr';
  if (primary === 'de') return 'de';
  if (primary === 'es') return 'es';
  if (primary === 'it') return 'it';
  if (primary === 'id') return 'id';
  if (primary === 'ar') return 'ar';
  if (primary === 'ru') return 'ru';
  if (primary === 'tr') return 'tr';
  if (primary === 'bn') return 'bn';
  if (primary === 'ja') return 'ja';
  if (primary === 'ko') return 'ko';
  if (primary === 'th') return 'th';
  if (primary === 'hi') return 'hi';
  return null;
}

function readUrlLocale(): Locale | null {
  const search = new URLSearchParams(window.location.search).get('lang');
  if (search) return normalizeLocale(search);
  const hash = window.location.hash.replace(/^#\??/, '');
  return normalizeLocale(new URLSearchParams(hash).get('lang'));
}

function readStoredLocale(): Locale | null {
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function readBrowserLocale(): Locale | null {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of languages) {
    const locale = normalizeLocale(lang);
    if (locale) return locale;
  }
  return null;
}

export function detectInitialLocale(): Locale {
  return readUrlLocale() ?? readStoredLocale() ?? readBrowserLocale() ?? 'en';
}

let currentLocale: Locale = detectInitialLocale();
const listeners = new Set<() => void>();
applyDocumentLocale(currentLocale);

export function getLocale(): Locale {
  return currentLocale;
}

export function getMessages(): Translation {
  return messages[currentLocale] ?? messages.en;
}

export function setLocale(locale: Locale, persist = true): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  applyDocumentLocale(locale);
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore private-mode storage failures; the current page still updates.
    }
  }
  listeners.forEach((listener) => listener());
}

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
