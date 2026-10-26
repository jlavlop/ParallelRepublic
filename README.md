# Repúblicas Paralelas · Parallel Republics

Funda una república a lo largo de un paralelo y descubre qué ciudades, países y artistas comparten tu latitud. Nació de una broma: Marín, Gósol, Detroit y Biskek están todas en el paralelo 42 N.

*Found a republic along a parallel of latitude and discover which cities, countries and artists share it.*

## Qué hace

- Mapa plano o globo 3D (MapLibre GL) con las franjas de latitud de cada república.
- Para cada república: población y PIB estimados, superficie, países que atraviesa de oeste a este, ciudades, capital, artistas nacidos en la franja y una ruta por el paralelo.
- Gemelos de latitud de cualquier ciudad y un botón «Sorpréndeme».
- Ficha coleccionable en PNG con bandera generada, y enlace para compartir cada república.
- Crónica automática y gratuita (lema, gentilicio, himno, folklore y viajes) que combina tradiciones reales del Patrimonio Cultural Inmaterial de la UNESCO de los países de la franja. Como opción avanzada, Claude puede escribirla con la clave de la API de Anthropic de cada jugador, guardada solo en su navegador.
- Personas ilustres nacidas en la franja elegidas con criterios de variedad: al menos un 40 % de mujeres cuando las hay, como máximo dos por país, varias disciplinas y la mitad de los puestos para figuras menos conocidas o de países poco representados.
- Español e inglés.

## Datos

| Qué | Fuente | Licencia |
| --- | --- | --- |
| Fronteras, población y PIB por país | [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 | Dominio público |
| Ciudades de más de 15 000 habitantes | [GeoNames](https://www.geonames.org/) cities15000 | CC BY 4.0 |
| Artistas, género y lugar de nacimiento | [Wikidata](https://www.wikidata.org/) | CC0 |
| Patrimonio Cultural Inmaterial de la UNESCO | [Wikidata](https://www.wikidata.org/) | CC0 |

La población de una franja es una estimación: la de cada país se reparte un 60 % según dónde viven sus ciudades de más de 15 000 habitantes y un 40 % según la superficie que cae dentro de la franja. El PIB se reparte igual.

Para los artistas, la consulta a Wikidata usa un listón de fama más bajo para las mujeres, para que no queden tapadas por la sobrerrepresentación masculina de las fuentes, e incluye disciplinas como la ilustración, el cómic, la cerámica o la coreografía. Después se guarda una selección variada por cada franja de 0,25°. `scripts/build-data.mjs` descarga las fuentes y genera `site/data/`; GitHub Actions lo ejecuta en cada cambio y el día 1 de cada mes.

## Estructura

```
site/            web estática (index.html, styles.css, js/)
site/data/       datos generados (no se suben al repositorio)
scripts/         lib.mjs + build-data.mjs: descarga y prepara los datos
tests/           pruebas con node:test
.github/workflows/deploy.yml   pruebas, datos y despliegue en GitHub Pages
```

## En tu ordenador

Necesitas Node 20 o superior, `unzip` y Python 3 para el servidor local.

```bash
npm test           # pruebas
npm run data       # descarga y genera site/data (tarda unos minutos por Wikidata)
npm run dev        # abre http://localhost:8000
```

`node scripts/build-data.mjs --no-wikidata` genera los datos sin la consulta de artistas, que es la parte lenta.
