# Third-party notices

VoltGecko application source is licensed under the [MIT License](LICENSE). Third-party components retain their own licenses and copyright notices. The application license does not replace those terms.

## Runtime dependencies

The exact installed versions and declared licenses are recorded in [`package-lock.json`](package-lock.json). Direct runtime dependencies are:

| Component | License | Purpose |
| --- | --- | --- |
| [React / React DOM](https://github.com/facebook/react) | MIT | Interface |
| [Dexie](https://github.com/dexie/Dexie.js) | Apache-2.0 | Local IndexedDB storage |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Portable project archives |
| [jsPDF](https://github.com/parallax/jsPDF) | MIT | PDF output |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC, with Feather attribution | Interface icons |
| [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | PDF floor-plan import |

The build generates `public/THIRD_PARTY_NOTICES.txt` from the LICENSE, COPYING and NOTICE files of installed production dependencies, including transitive dependencies. Vite copies this file into `dist/THIRD_PARTY_NOTICES.txt` for distribution with the application. `scripts/copy-public-assets.mjs` runs automatically before development and production builds.

PDF.js CMaps, standard fonts and image codecs carry additional notices. `scripts/copy-pdf-assets.mjs` copies their original notice and license files unchanged into `public/pdfjs/` and the build output.

## Fonts and symbols

- Noto Sans: Copyright 2018 The Noto Project Authors, licensed under SIL Open Font License 1.1. The complete notice is in [`public/fonts/OFL.txt`](public/fonts/OFL.txt).
- Original electrical SVG symbols: CC0 1.0 dedication, as described in [`SYMBOLS.md`](SYMBOLS.md). They are not copied from an IEC symbol database and are not IEC-certified.

## Product information and brand assets

Schneider Electric, Easy9 Pro, Easy9 EU, Acti9 and PrismaSeT are names of their respective owners. Product references and technical facts are attributed to the [official Easy9 Pro catalogue](https://www.se.com/hu/hu/download/document/Easy9Pro_catalog_HU/) in the catalogue data. The repository MIT license does not grant rights to third-party trademarks or manufacturer catalogue artwork. No manufacturer endorsement is claimed.

Schneider Electric photographs are sourced from its official product images, the Easy9 Pro catalogue above, the [Schneider Kaedra/Mureva catalogue](https://lipapromet.hr/wp-content/uploads/2025/11/15.SCHNEIDER-KAEDRA-ORMARI.pdf), the [PrismaSeT XS catalogue](https://docs.vekto.nl/media/schneider-electric/schneider-electric-folderprismasetxss.pdf), the [Linergy catalogue](https://tilcom-bg.com/files/mf/products/217_info_file.pdf), the [Acti9 catalogue](https://xonstorage.z8.web.core.windows.net/pdf/SAchneider_a9d34610.pdf), and the [LVS04227 product datasheet](https://www.tim.pl/api/v1/assets/MDAwMS0wMDAxNC00MTI1My8wMDAxLTAwMDE0LTQxMjUzXzYucGRm.pdf). Images shared by a family of products are identified in the interface as illustrations; the application license does not grant rights to this artwork.

Tracon Electric product photographs are shown with the corresponding catalogue entries. The FLEAL-16/1, FLEAL-16/1K and FLEAL-16/1ZS photographs are sourced from their [Világítás Center product pages](https://www.vilagitascenter.hu/villanyszerelesi-segedanyagok/sorkapcsok_337/fovezeteki_sorkapocs_887); other Tracon photographs are sourced from the manufacturer's product pages. Tracon and the photographs remain the property of their respective owners; the application license does not grant rights to them.

The VoltGecko brand concepts were generated using the built-in image generation tool. Generation prompts are retained under `branding/`; the selected application assets are in `public/brand/`.
