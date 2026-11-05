# VoltGecko

![VoltGecko cyberpunk logo](public/brand/voltgecko-cyberpunk-logo.png)

Offline-first electrical floor-plan and distribution-board planner, in **English and Hungarian**. Built with React, TypeScript, Vite and an installable PWA; projects stay on the user's device unless the user exports a file or explicitly saves to Google Drive.

[Magyar útmutató](#magyar) · [GitHub](https://github.com/molnard-labs/VoltGecko) · [MIT License](LICENSE)

**Live app / Élő alkalmazás:** [voltgecko.pages.dev](https://voltgecko.pages.dev)

## English

### Features

- Start with a blank project, open a project file or a local project, or explicitly choose the sample. Starting and reloading never creates or opens a sample automatically.
- Choose light or dark appearance and standard or large text. The interface uses larger controls and high-contrast colors; your appearance settings stay on the device.
- Import PDF pages, PNG and JPG floor plans; use multiple sheets, layers, scale calibration, zoom, device placement and rotation.
- Share device identities and properties across floor plans, circuits, distribution boards and single-line diagrams. Record room, mounting height, product details, notes and site photos.
- Switch the whole floor plan between **Symbols** and **Real images**. Assign a separate image to each device by uploading a PNG/JPG/WebP or choosing a site photo; set its display size, rotation and opacity. Devices without an image show a neutral placeholder in image mode. Both PDF audiences follow the saved display mode, preserving photo proportions and transparency.
- Arrange DIN devices and connect their terminals in one cabinet drawing, with module markers, phase/N/PE busbars, incoming supplies and cross-board wires. Move devices by their grips with half-module snapping, or use the row and starting-position fields; collisions and overcapacity remain visible. Wire routes and labels stay editable, and manual bends remain in place when devices move.
- In **Board**, choose the new cabinet drawing or the previous board editor. The new drawing supports terminal wiring, editable routes and an automatically generated single-line view. Link its protective devices to shared project circuits, which can also be assigned to floor-plan devices. Its drawing is saved with the project; existing classic board layouts are not converted automatically.
- Reuse a selected source with continuous wiring, choose named wire colours or a custom colour, and document green-yellow PE wires in the editor and single-line exports. Automatic routes leave each terminal on its selected side and use available gaps and outer gutters; saved manual routes remain editable.
- Search the bundled Schneider catalogue offline: 260 references from the Hungarian Easy9 Pro catalogue, including DIN devices, enclosures and accessories. Each entry retains its manufacturer source.
- Export customer and detailed PDF documents, including legends, circuit lists and board layouts. Export the single-line drawing as SVG or PNG.
- Save automatically to IndexedDB, save named versions, restore without overwriting history, and transfer a complete project as one compressed `.vgecko` archive with photos and attachments.
- Optionally open or save a snapshot to Google Drive. No account is needed for local use.

### Development

Use **Node.js 22.13+ in the 22 release line**, or **Node.js 24 LTS**. `.node-version` selects the latest Node 22 release for Cloudflare Pages and CI. Node 24 also works locally.

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). The development server is available on the local network. A phone needs trusted HTTPS for PWA installation and secure browser APIs; see [local HTTPS](#local-https--helyi-https).

### Offline production preview

```sh
npm run build
npm run preview
```

Open [localhost:4173](http://localhost:4173) and wait for **Ready for offline use**. The production build contains the service worker and local PDF resources. After the first successful load, the app can reopen offline with its saved photos and projects. Updates are applied through the app's update prompt.

Editors, the manufacturer catalogue, sample data and Drive panel load when first used. PDF import and export also load separately; the PDF-only React server renderer has its own build chunk. The service worker still precaches every JavaScript/CSS chunk, font and PDF resource before reporting offline readiness, so a feature can be opened for the first time without a network connection. This reduces startup parsing and execution; the complete offline download still includes all features. Browser tests use the Vite build manifest to check these boundaries and the default 500 kB JavaScript chunk budget.

Editor base styles are imported centrally in `main.tsx`, before the shared appearance overrides. Keep this order when adding a lazy editor: loading its base CSS later would change the cascade and could undo readability and mobile layout fixes.

Browser storage is tied to the exact origin: localhost, a LAN address, a production domain and preview deployment URLs each have separate data. Export a project file to move work between them. Keep external `.vgecko` backups; clearing browser storage or losing the device can remove the local copy. Project files are ZIP archives and are not encrypted.

### Cloudflare Pages with Git integration

The app is a static site: no application server, database, Pages Functions or runtime secrets are required.

1. In Cloudflare **Workers & Pages → Create application → Pages**, import the GitHub repository **molnard-labs/VoltGecko**. Grant the Cloudflare GitHub app access to this repository when requested.
2. Configure the build:

   | Setting | Value |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | React (Vite), or None with the settings below |
   | Root directory | Repository root |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Node.js | Read from `.node-version` (`22`) |

3. Save and deploy. Git integration rebuilds the site when commits reach the connected branch; pull requests can receive preview deployments.
4. Load the deployed HTTPS URL and wait for the offline-ready indication before installing the PWA or testing offline use.

No environment variables are needed for the core application. Google Drive configuration is optional; `VITE_` values are public build-time configuration, never a place for client secrets. Preview domains use separate browser storage. Use project export/import when changing domains.

Official references: [Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Node version selection](https://developers.cloudflare.com/pages/configuration/build-image/).

### Checks and contributions

```sh
npm test
npm run build
```

Optional browser checks:

```sh
npx playwright install chromium
npm run test:e2e
```

For WebKit, install `webkit` and set `PLAYWRIGHT_BROWSER=webkit` before running the browser tests. Mobile emulation does not replace installation checks on physical Android and iPhone devices. GitHub Actions runs the unit tests and production build for pushes to `main` and pull requests.

The displayed brand and `.vgecko` filename extension are configured in `src/config.ts`; translations are in `src/locales/en-*.ts`. The native `.vgecko` project format uses ZIP compression to keep the plan, photographs, attachments and complete revision history together. Local opening and Google Drive use this same format.

The welcome screen and editor footer show the source commit date and time, using Europe/Budapest time without a city or timezone suffix. Clicking it opens the exact GitHub commit embedded in that build. Offline copies retain their own date and commit link. Local builds with uncommitted changes are labelled as local and do not claim an exact commit.

### Code structure

| Location | Responsibility |
| --- | --- |
| `src/App.tsx`, `src/app/` | Workspace coordination, document session/autosave/undo, navigation and project panels. Panel-specific state stays in its panel. |
| `src/components/` | Floor-plan, board, circuit and device editors. `board-wiring/` separates diagram interaction, wire editing and supply/bus editing. |
| `src/data/` | Project operations, board placement, wiring rules and floor-plan geometry; `storage.ts` owns IndexedDB access. |
| `src/data/archive/` | The project-file format, validation, assets, ZIP integrity, encoding and file saving. `data/archive.ts` is its public API. |
| `src/services/` | Background import, PDF/diagram export, Google Drive and linked-file integrations. Shared browser downloads and filename handling live in `files.ts`. |
| `src/products/`, `src/locales/` | Manufacturer source data and product creation; interface translations. |

Keep electrical and placement rules in `data/`, so every editor and export uses the same behavior. Pass changes to the document session rather than keeping separate project copies in each view. Existing revisions and assets are immutable and may be shared between checkpoints; replace them when editing. The sample generator lives separately in `data/demo.ts`. Add a module for a distinct responsibility, without generic repositories, event buses or compatibility wrappers. Test domain edge cases with Vitest and cross-view, file and offline workflows with Playwright.

### Scope

VoltGecko documents devices, circuits and explicitly entered terminal wiring. Connectivity checks and phase-load summaries do not certify electrical compliance. Voltage drop is a resistive estimate available only with user-supplied manufacturer resistance, length and load current; it omits reactance and operating-temperature corrections. The app does not select cable sizes or calculate protective-device coordination. The original drawing-symbol library is documented in [SYMBOLS.md](SYMBOLS.md); it is not IEC-certified. Manufacturer catalogue data does not imply automatic electrical or mechanical compatibility checking.

The application source is MIT licensed. Fonts, PDF resources and other dependencies retain their original licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). The sample project is fictional.

## Magyar

A VoltGecko offline is használható alaprajz- és elosztótervező. A felső **HU / EN** választóval magyar és angol felület között válthatsz; a PDF rendszerfeliratai is a választott nyelven készülnek. A meglévő projektadatokat a nyelvváltás nem írja át.

Induláskor a kezdőképernyőn választhatsz: **Új projekt**, **Projekt megnyitása** vagy **Mintaprojekt kipróbálása**. A helyi projektek külön listából nyithatók meg; automatikusan nem indul sem minta, sem korábban mentett terv. A **Téma** és **Betűméret** beállítás a kezdőképernyőn, munka közben az oldalsó eszköztár alján érhető el. Világos/sötét megjelenés és normál/nagy betű választható; a böngésző megjegyzi őket.

### Indítás és használat

Node.js 22.13+ (22-es ág) vagy Node.js 24 LTS szükséges. Klónozás után `npm ci`, majd `npm run dev`; megnyitás: [localhost:5173](http://localhost:5173). Az offline működéshez `npm run build`, majd `npm run preview`; megnyitás: [localhost:4173](http://localhost:4173). Várd meg az **Offline használatra kész** jelzést.

- A PDF minden oldala külön tervlapként importálható; PNG/JPG vagy üres tervlap is használható. Az eszköz kijelölés után húzással vagy nyílbillentyűkkel mozgatható. A Delete csak a tervlapról veszi le; az adatlap törlés gombja a közös eszközt törli.
- A kapcsolat és vezérlés eszközzel két eszköz összeköthető. A töréspontok húzhatók; dupla kattintás új töréspontot ad. A méretarány két pont és ismert távolság alapján kalibrálható.
- Az elosztóban a készülékek elhelyezése és a kapcsok huzalozása egy közös szekrényrajzon történik. A fogantyúval félmodulos lépésekben, sorok között is mozgathatók; a sor és kezdőhely mezőkkel is megadható. A program jelzi az ütközést és túlfoglalást. A kézi vezetéktöréspontok mozgatáskor helyben maradnak. Az egyvonalas nézet a megadott készülékkapcsolatokból épül fel.
- Az áramkörhöz védelmi készülék, kábelmegnevezés, fogyasztótípus és teljesítmény rögzíthető. Ezek dokumentációs adatok; nem indítanak automatikus villamos méretezést.
- A fotók, megjegyzések és eszközadatok ugyanahhoz az eszközhöz tartoznak minden nézetben. Az ügyfél- és részletes PDF mellett az egyvonalas rajz SVG-ként is menthető.

Az alaprajz **Rajzjelek / Valós képek** kapcsolója az egész projekt megjelenítését állítja; a választás mentés és újranyitás után is megmarad. Az eszköz adatlapjának **Alaprajzi megjelenítési kép** részében külön PNG/JPG/WebP kép tölthető fel, vagy egy meglévő helyszíni fotó választható. A képméret és fedettség itt, a forgatás a szokásos forgatásvezérlővel állítható. A képes nézetben kép nélküli eszköznél semleges helyőrző jelenik meg. Az ügyfél- és szakmai PDF egyaránt a kiválasztott nézetet használja, a képarány, forgatás és átlátszóság megtartásával.

Az üres tervlapra kattintva vagy PDF/PNG/JPG fájlt ráhúzva alaprajz tölthető fel. Az első oldal az üres lapot tölti ki; a további oldalak, illetve a már rajzot tartalmazó lapra húzott fájlok új tervlapra kerülnek. A kereshető eszköztár öt csoportban 27 alaprajzi típust kínál, köztük kilenc kapcsolóváltozatot. A változatok saját rajzjele és megnevezése a mentett projektben és a PDF jelmagyarázatában is megmarad; hosszú jelmagyarázat esetén külön oldal tartalmazza a teljes listát.

### Terméktár

A beépített terméktár a Schneider Electric **Easy9 Pro Katalógus 2025., 2.0 kiadás (2026. április 2.)** 6–34. oldalának **260 rendelési cikkszámát** tartalmazza: 112 Easy9 Pro DIN-készülék, 1 Acti9 DIN-távtartó, 72 szekrény és 75 tartozék. [Gyártói forrás](https://www.se.com/hu/hu/download/document/Easy9Pro_catalog_HU/). A lista offline kereshető; nem automatikusan frissülő, teljes világpiaci adatbázis. Az Easy9 EU és PrismaSeT XS elemek a saját termékcsaládnevükön szerepelnek.

A DIN-készülék az első szabad helyre kerül, a szekrény új elosztót hoz létre, a sínhelyet nem foglaló tartozék az anyaglistába kerül. A modulszélesség alapja 18 mm. A projektben a kiválasztott termékadatok önálló másolatként megmaradnak; későbbi katalógusfrissítés nem módosítja a kész terveket.

### Részletes huzalozás

Az **Elosztó** nézetben az új **Szekrényrajz** és a **Korábbi elosztónézet** között lehet váltani. Az új szerkesztőben a védelmi készüléknél meglévő közös áramkör választható vagy új áramkör hozható létre; ugyanez az áramkör az alaprajzi eszköz adatlapján is hozzárendelhető. Az új rajz, a készülékek és vezetékek a projekttel és a `.vgecko` mentéssel együtt tárolódnak. A korábbi elosztórajzok nem alakulnak át automatikusan, továbbra is a korábbi nézetben szerkeszthetők. Az új egyvonalas rajz a szekrényrajz saját lapján érhető el.

A fő **Egyvonalas** nézetből az új rajz is megnyitható. Az ügyfél- és részletes projekt-PDF a korábbi szakaszok mellett az új szekrényrajzot és egyvonalas rajzot is tartalmazza, ha van mentett új elosztóterv.

Ha az átmenetileg önálló elosztótervezővel ugyanebben a böngészőben készült mentés, az új szekrényrajz **Elosztóterv** menüjében külön helyreállítható. Ez a nyitott projekt új szekrényrajzát lecseréli, ezért a program megerősítést kér; a korábbi böngészős mentés megmarad.

Az új szerkesztő alapja a felhasználó által megosztott [Elosztó tervező](https://drive.google.com/drive/folders/1SwF6uW1N07TDwQtI6ybErwKUzm7RpYBC) HTML-állomány. A megosztás önmagában nem határozza meg az átvett forrás licencfeltételeit.

Az elosztónézet **Részletes huzalozás** szakaszában két csatlakozópont kiválasztásával és a vezeték hozzáadásával köthetők a készülékek. A pontok a rajzon és billentyűzettel kezelhető listákból is kiválaszthatók; a sorrend nem módosítja a pólust. Másik elosztó végpontja is választható. A DIN-elhelyező és a készülékszintű táplálási kapcsolatok ugyanennek a tervnek a részei.

A **Folyamatos bekötés** megtartja a kezdőpontot, így egymás után több végponthoz köthetsz vezetéket. A vezeték színe barna, fekete, szürke, kék, zöld-sárga vagy egyéni szín lehet; a zöld-sárga jelölés az egyvonalas exportban is megmarad. Az automatikus nyomvonal a kapocs oldalának megfelelően indul, és a készülékek közötti vagy melletti helyet használja. A kézzel beállított töréspontokat a program megőrzi.

A sínek kapocsszáma, vezetője, sorhoz rendelése és kapocsfeliratai szerkeszthetők. A vezetéken szín, kábelmegnevezés, érszám, keresztmetszet, anyag, hossz és gyártói ellenállás rögzíthető. A nyomvonal töréspontjai és feliratai húzással vagy számértékkel mozgathatók. A készülék adatlapján külön villamos szerep, póluskiosztás, névleges áram és ÁVK-adatok adhatók meg.

A fázisterhelés a rögzített áramköri teljesítmények összege. A kiegyensúlyozás csak a kiosztatlan egyfázisú áramköröket módosítja. Az egyvonalas nézetben egy elosztó vagy az összes elosztó együtt választható; minden megadott kapcsolat megmarad. A fizikai vezeték rajzolási sorrendje nem állít táplálási irányt. SVG, PNG és böngészős nyomtatás is elérhető; a részletes PDF külön huzalozási és sínjegyzéket tartalmaz.

### Az oldalon látható frissítés

A kezdőképernyő és a szerkesztő láblécében látható az adott kiadás forráscommitjának dátuma, budapesti idő szerint. A dátumra kattintva pontosan a megjelenített verzió GitHub-commitja nyílik meg. Az offline példány a saját kiadásának dátumát és linkjét őrzi. Nem commitolt helyi módosítások esetén külön helyi változat jelzés jelenik meg.

### Mentés és adatkezelés

Az automatikus mentés az adott böngészőprofil IndexedDB-tárába kerül. A **Projektfájl mentése** az alkalmazás saját `.vgecko` formátumában, ZIP-tömörítéssel viszi magával a teljes tervet, fotókat, előzményeket és mellékleteket. Ez a külső biztonsági mentés és az eszközök közötti átadás alapja; a helyi megnyitás és a Google Drive is ezt a formátumot használja. A fájl nincs titkosítva.

A **Verzió mentése**, **Előzmények** és **Visszaállítás** funkciók megőrzik az állapotokat; visszaállításkor a jelenlegi állapot is megmarad. Azonos azonosítójú, eltérő projektimport külön másolatként nyílik meg. Automatikus összefésülés nincs.

A böngészőadatok törlése vagy az eszköz elvesztése a helyi példányt is eltávolíthatja. A localhost, a telefonos LAN-cím, a nyilvános domain és az előnézeti URL külön tárhelyet használ: projektfájllal vihető át a munka. A PDF átadási dokumentum; szerkesztésre a projektfájl szolgál.

A támogató böngészőkben az **Automatikus mentés fájlba…** gombbal teljes `.vgecko` archívum kapcsolható a projekthez az adott munkamenetre. A fájlt újranyitáskor ismét ki kell választani. A mentések sorban futnak; a fájl tartalmának külső változása szünetelteti a mentést. Az IndexedDB-mentés eközben is megmarad.

### Google Drive

Google-beállítás nélkül az alkalmazás teljesen használható. Saját OAuth-konfigurációhoz másold a `.env.example` fájlt `.env.local` névre; a pontos lépések a [helyi integrációk útmutatójában](src/services/README.md) találhatók. A nyilvános domainhez annak pontos eredetét is engedélyezni kell a Google Cloud projektben.

A Google-könyvtárak csak csatlakozáskor töltődnek be. A hozzáférési token memóriában marad, a kért jogosultság `drive.file`. Minden kézzel indított Drive-mentés új projektpillanatkép; nincs háttérszinkron vagy saját szerveren tárolt projektadat.

### Local HTTPS / Helyi HTTPS

Telefonos helyi teszthez azonos hálózat és megbízható HTTPS szükséges. A telefon saját `localhost` címe a telefont jelenti.

```powershell
# Egyszeri telepítés / install once:
winget install FiloSottile.mkcert
# A PC tényleges LAN IP-címével / use the PC's actual LAN address:
powershell -ExecutionPolicy Bypass -File scripts/setup-local-https.ps1 -LanAddress 192.168.1.10
npm run build
npm run preview:https
```

Nyisd meg a telefonon a `https://<PC-IP>:4173` címet. A mkcert helyi CA-jának `rootCA.pem` tanúsítványát telepíteni és megbízhatóvá tenni kell. iPhone-on a profil telepítése után a tanúsítvány megbízhatóságát külön is engedélyezni kell; Androidon a tanúsítványkezelésben telepíthető. A `rootCA-key.pem` magánkulcsot ne másold át és ne oszd meg. A `.cert/` és `.env.local` helyi, Gitből kizárt fájlok.

iPhone: Safari → Megosztás → Főképernyőhöz adás. Android: Chrome → Telepítés / Főképernyőhöz adás. A nyilvános HTTPS-oldal használatához helyi tanúsítvány nem kell.

### Licenc és szakmai határok

Az alkalmazás forráskódja [MIT licencű](LICENSE). A saját SVG-jelek CC0 felajánlása és szakmai ellenőrzésük állapota a [SYMBOLS.md](SYMBOLS.md) fájlban olvasható. A függőségek és betűk eredeti licence megmarad: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

A program eszköz-, áramkör- és kapocsszintű dokumentálást támogat. A huzalozási ellenőrzések és fázisterhelések nem megfelelőségvizsgálatok. A feszültségesés csak megadott gyártói ellenállás, hossz és terhelőáram alapján becsülhető, reaktancia és üzemi hőmérséklet korrekciója nélkül. Automatikus vezetékméretezést és védelmi koordinációt nem végez. A rajzjelek szakmai megfeleltetése még szükséges; a könyvtár nem IEC-tanúsított. A mintaprojekt fiktív.
