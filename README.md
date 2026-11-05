# VoltGecko – elosztótervező

A VoltGecko jelenlegi belépési pontja a megosztott, önálló elosztótervező alkalmazáson alapul. Villamos elosztószekrények elrendezésére, huzalozásának dokumentálására és a megadott kapcsolatokból egyvonalas rajz készítésére szolgál. A felület magyar nyelvű, az adatfeldolgozás a böngészőben történik.

## Indítás és build

Node.js 22.13 vagy újabb 22-es, illetve Node.js 24 LTS szükséges.

```sh
npm ci
npm run dev
```

A fejlesztői oldal a terminálban kiírt címen, alapértelmezetten a [localhost:5173](http://localhost:5173) címen nyílik meg. A kiadási build és helyi előnézete:

```sh
npm run build
npm run preview
```

Az előnézet alapértelmezett címe [localhost:4173](http://localhost:4173). A statikus build a `dist` könyvtárba kerül. A böngészőtár az adott címhez és porthoz kötődik: a fejlesztői oldal, az előnézet és az éles oldal külön helyi mentéseket használ.

## Használat

A **Szekrény** nézetben sorokba helyezhetők és mozgathatók a készülékek. A csatlakozási pontok között vezetékek húzhatók, színeik, kábeladataik és útvonalaik szerkeszthetők. Egy projekthez több doboz, fázissín, N- és PE-sín, valamint készülékenkénti betáplálás is megadható. A **Fázisok** funkció a még ki nem osztott egyfázisú áramkörökhöz fázist rendelhet.

Az **Egyvonalas** nézet a megadott kapcsolatokból rajzot készít. A szekrényrajz és az egyvonalas rajz SVG vagy PNG formátumban menthető, illetve nyomtatható. A papírméret a rajznál választható. Az ellenőrzés többek között a betáplálatlan készülékekre és egyes megadott kábel- vagy védelmi adatok eltéréseire figyelmeztet.

Az ellenőrzés tájékoztató jellegű: az eredmény nem tanúsítja a terv szabványosságát vagy biztonságosságát. A méretezést és a terv ellenőrzését megfelelően képzett szakembernek kell elvégeznie.

## Projektek és mentés

Az alkalmazás a munkát automatikusan a böngésző `localStorage` tárába menti. A **Projekt** menüben JSON-projekt menthető és tölthető be. A megosztott forráshoz tartozó `kistarcsa-eloszto.json` ilyen projektfájl; a Projekt menü **Betöltés fájlból** parancsával nyitható meg. Az első indításkor az alkalmazás mintát jelenít meg, ha nincs korábbi helyi mentés.

A **Projekt → Automatikus mentés fájlba** lehetőség a File System Access API-t támogató böngészőkben – például támogatott Chrome- és Edge-változatokban – érhető el. A fájlhozzáféréshez böngészős engedély kell; külső fájlmódosítás észlelésekor a mentés szünetel. Más böngészőben a JSON-fájl kézzel menthető és nyitható meg. A megosztott változat leírása egy külön helyi szervert is említ, de annak fájljai nem részei az átvett csomagnak; a telepítés és a fájlmentés nem támaszkodik rá.

A JSON a jelenlegi elosztótervező saját formátuma. A korábbi VoltGecko `.vgecko` projektarchívumok ezzel a belépési ponttal nem nyithatók meg, és a két formátum között nincs automatikus átalakítás. A böngészőadatok törlése vagy az eszköz elvesztése a helyi példányt is eltávolíthatja, ezért érdemes JSON-fájlba mentett biztonsági másolatot tartani.

## Forrás és projektszerkezet

A jelenlegi alkalmazás alapja a felhasználó által megosztott [Elosztó tervező Drive-mappa](https://drive.google.com/drive/folders/1SwF6uW1N07TDwQtI6ybErwKUzm7RpYBC) `eloszto-tervezo.html` állománya és annak leírása. A minta az ugyanott található `kistarcsa-eloszto.json`. A forrás és a minta eredete ezzel dokumentált; a megosztás önmagában nem határozza meg az azokhoz tartozó licencfeltételeket.

Az alkalmazás belépési pontja az `index.html`. A repóban megmaradt korábbi React/TypeScript forrás és a hozzá írt tesztek az előző alkalmazásváltozathoz tartoznak; nem ezek alkotják a jelenlegi felületet. Az új belépési pont módosításakor ezért a jelenlegi alkalmazás működését is külön ellenőrizni kell.

Az `npm run test:e2e` a jelenlegi felület böngészős tesztjeit futtatja; a tesztminta személyes projektadatai anonimizáltak. Az `npm test` a megőrzött korábbi TypeScript-kód egységtesztjeit futtatja. A többi, régi felülethez tartozó böngészőteszt történeti referenciaként maradt a repóban.
