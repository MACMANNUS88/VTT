/**
 * Apify Actor - Scraper 99Spokes
 * Scrape les fiches vélo de 99spokes.com et exporte un JSON structuré.
 *
 * Comment utiliser :
 * 1. Dans Apify, crée un nouvel Actor (Development > My Actors > Create new)
 * 2. Sélectionne "JavaScript" comme langage
 * 3. Remplace le code par ce fichier
 * 4. Lance avec les paramètres d'entrée ci-dessous
 */

import { CheerioCrawler, Dataset, log } from 'crawlee';

// ─── Paramètres d'entrée (modifiables dans l'UI Apify) ───────────────────────
const INPUT = {
    year: '2025',
    categories: ['mountain', 'road', 'gravel', 'electric', 'city', 'kids'],
    maxBikes: 2000,
    locale: 'en-EU',
};

const BASE = `https://99spokes.com/${INPUT.locale}`;

// ─── Extracteur de specs depuis la page vélo ─────────────────────────────────
function extractBike($, url) {
    const bike = { url, source: '99spokes' };

    // Extraire depuis les données JSON embarquées (Next.js __NEXT_DATA__)
    const nextData = $('script#__NEXT_DATA__').html();
    if (nextData) {
        try {
            const json = JSON.parse(nextData);
            // Naviguer dans la structure Next.js
            const props = json?.props?.pageProps
                        || json?.props?.initialProps
                        || {};
            const bikeData = props?.bike || props?.product || props?.data?.bike || {};

            if (bikeData.name || bikeData.model) {
                return extractFromNextData(bikeData, url);
            }
        } catch (e) {
            log.debug(`Erreur parsing __NEXT_DATA__ pour ${url}: ${e.message}`);
        }
    }

    // Fallback : extraction HTML classique
    return extractFromHtml($, url);
}

function extractFromNextData(data, url) {
    const parts = url.split('/');
    const brand = parts[parts.length - 3] || '';
    const year  = parts[parts.length - 2] || '';
    const slug  = parts[parts.length - 1] || '';

    return {
        url,
        source: '99spokes',
        brand:       data.brand?.slug || data.brand?.name || brand,
        model_slug:  data.slug || slug,
        model_name:  data.name || data.model || '',
        year:        data.year || year,
        description: data.description || '',
        price_usd:   data.price?.amount || data.msrp || null,
        price_eur:   data.price?.eur || null,
        category:    data.category || '',
        sub_category:data.subCategory || '',
        // Specs
        frame:       data.specs?.frame || data.frameMaterial || '',
        suspension:  data.specs?.suspension || '',
        travel_f:    parseInt(data.specs?.forkTravel || data.forkTravel || 0),
        travel_r:    parseInt(data.specs?.rearTravel || data.rearTravel || 0),
        fork:        data.specs?.fork || '',
        shock:       data.specs?.rearShock || data.specs?.shock || '',
        wheels:      data.specs?.wheels || data.specs?.wheelSize || '',
        drivetrain:  data.specs?.drivetrain || '',
        groupset:    data.specs?.groupset || data.specs?.drivetrain || '',
        brakes:      data.specs?.brakes || '',
        weight_kg:   parseFloat(data.specs?.weight || 0) || null,
        motor:       data.specs?.motor || data.motor || '',
        battery_wh:  parseInt(data.specs?.battery || 0) || null,
        images:      (data.images || []).map(i => i?.url || i).filter(Boolean),
        geometry:    data.geometry || {},
        raw:         data.specs || {},
    };
}

function extractFromHtml($, url) {
    const parts = url.split('/');
    const brand = parts[parts.length - 3] || '';
    const year  = parts[parts.length - 2] || '';
    const slug  = parts[parts.length - 1] || '';

    const specs = {};
    // Tableaux de specs classiques
    $('table tr, dl dt, .spec-row, [data-spec], .specs-table tr').each((_, el) => {
        const key = $(el).find('th, dt, .spec-label, td:first-child').first().text().trim();
        const val = $(el).find('td:last-child, dd, .spec-value').last().text().trim();
        if (key && val) specs[key.toLowerCase()] = val;
    });

    // Schéma JSON-LD
    let jsonLd = {};
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const d = JSON.parse($(el).html());
            if (d['@type'] === 'Product') jsonLd = d;
        } catch (e) {}
    });

    const name = $('h1').first().text().trim()
              || jsonLd.name || '';
    const desc = $('meta[name="description"]').attr('content')
              || $('[class*="description"]').first().text().trim().slice(0, 300)
              || jsonLd.description || '';
    const priceStr = jsonLd.offers?.price
                  || $('[class*="price"]').first().text().replace(/[^0-9.]/g, '');
    const price = parseFloat(priceStr) || null;

    const imgs = [];
    $('img[src*="99spokes"], img[src*="cloudfront"], [class*="bike-image"] img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !imgs.includes(src)) imgs.push(src);
    });

    return {
        url, source: '99spokes',
        brand, model_slug: slug, model_name: name, year,
        description: desc,
        price_usd: price, price_eur: price ? Math.round(price * 0.93) : null,
        category: '', sub_category: '',
        frame:     specs['frame'] || specs['frame material'] || '',
        suspension:specs['suspension'] || '',
        travel_f:  parseInt(specs['fork travel'] || 0),
        travel_r:  parseInt(specs['rear travel'] || 0),
        fork:      specs['fork'] || '',
        shock:     specs['rear shock'] || specs['shock'] || '',
        wheels:    specs['wheels'] || specs['wheel size'] || '',
        drivetrain:specs['drivetrain'] || '',
        groupset:  specs['groupset'] || specs['drivetrain'] || '',
        brakes:    specs['brakes'] || '',
        weight_kg: parseFloat(specs['weight'] || 0) || null,
        motor:     specs['motor'] || '',
        battery_wh:parseInt(specs['battery'] || specs['battery capacity'] || 0) || null,
        images:    imgs.slice(0, 5),
        geometry:  {},
        raw:       specs,
    };
}

// ─── URLs de départ ────────────────────────────────────────────────────────────
function buildStartUrls() {
    const urls = [];
    for (const cat of INPUT.categories) {
        urls.push(`${BASE}/bikes?year=${INPUT.year}&category=${cat}&page=1`);
    }
    return urls;
}

// ─── Crawler ───────────────────────────────────────────────────────────────────
const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: INPUT.maxBikes + 200,
    maxConcurrency: 3,
    requestHandlerTimeoutSecs: 30,

    async requestHandler({ $, request, enqueueLinks, log }) {
        const url = request.url;
        log.info(`Traitement : ${url}`);

        // Page de listing → extraire les liens vélo + pagination
        if (url.includes('/bikes?') || url.includes('/bikes#')) {
            // Liens vers les fiches individuelles
            const bikeLinks = [];
            $('a[href*="/bikes/"]').each((_, el) => {
                const href = $(el).attr('href');
                if (href && /\/bikes\/[^?#]+\/\d{4}\/[^?#]+$/.test(href)) {
                    const full = href.startsWith('http')
                        ? href : `https://99spokes.com${href}`;
                    bikeLinks.push(full);
                }
            });

            if (bikeLinks.length > 0) {
                log.info(`  ${bikeLinks.length} vélos trouvés sur cette page`);
                await enqueueLinks({ urls: [...new Set(bikeLinks)] });
            }

            // Pagination
            const nextHref = $('a[rel="next"], a[aria-label="Next"], .pagination a.next').attr('href');
            if (nextHref) {
                const nextUrl = nextHref.startsWith('http')
                    ? nextHref : `https://99spokes.com${nextHref}`;
                await enqueueLinks({ urls: [nextUrl] });
                log.info(`  Page suivante : ${nextUrl}`);
            }

            // Alternative : détecter la pagination par numéro
            const currentMatch = url.match(/page=(\d+)/);
            if (currentMatch && bikeLinks.length > 0) {
                const nextPage = parseInt(currentMatch[1]) + 1;
                const nextUrl = url.replace(/page=\d+/, `page=${nextPage}`);
                await enqueueLinks({ urls: [nextUrl] });
            }
            return;
        }

        // Page vélo individuelle → extraire les specs
        if (/\/bikes\/[^?#]+\/\d{4}\/[^?#]+/.test(url)) {
            const bike = extractBike($, url);
            if (bike.model_name || bike.model_slug) {
                await Dataset.pushData(bike);
                log.info(`  Vélo sauvegardé : ${bike.brand} ${bike.model_name} ${bike.year}`);
            } else {
                log.warning(`  Données vides pour ${url}`);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Échec : ${request.url}`);
    },
});

// ─── Lancement ─────────────────────────────────────────────────────────────────
log.info(`Démarrage scraper 99Spokes — Année ${INPUT.year}`);
log.info(`Catégories : ${INPUT.categories.join(', ')}`);
log.info(`Max vélos : ${INPUT.maxBikes}`);

await crawler.run(buildStartUrls());

const { itemCount } = await Dataset.getInfo();
log.info(`Terminé. ${itemCount} vélos extraits.`);
