export interface FeedSource {
  id: string;
  name: string;
  url: string;
  kind: "central-bank" | "market-news";
  /** Currencies every item from this feed is assumed to concern. */
  currencies: string[];
}

export const RSS_SOURCES: FeedSource[] = [
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", kind: "central-bank", currencies: ["USD"] },
  { id: "ecb", name: "European Central Bank", url: "https://www.ecb.europa.eu/rss/press.html", kind: "central-bank", currencies: ["EUR"] },
  { id: "boe", name: "Bank of England", url: "https://www.bankofengland.co.uk/rss/news", kind: "central-bank", currencies: ["GBP"] },
  { id: "boj", name: "Bank of Japan", url: "https://www.boj.or.jp/en/rss/whatsnew.xml", kind: "central-bank", currencies: ["JPY"] },
  { id: "boc", name: "Bank of Canada", url: "https://www.bankofcanada.ca/content_type/press-releases/feed/", kind: "central-bank", currencies: ["CAD"] },
  { id: "snb", name: "Swiss National Bank", url: "https://www.snb.ch/public/en/rss/pressrel", kind: "central-bank", currencies: ["CHF"] },
  { id: "rbnz", name: "Reserve Bank of New Zealand", url: "https://www.rbnz.govt.nz/feeds/news", kind: "central-bank", currencies: ["NZD"] },
  { id: "rba", name: "Reserve Bank of Australia", url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml", kind: "central-bank", currencies: ["AUD"] },
  { id: "fxstreet", name: "FXStreet", url: "https://www.fxstreet.com/rss/news", kind: "market-news", currencies: [] },
];

/** Keywords used to tag an article with the currencies it is about. */
export const CURRENCY_KEYWORDS: Record<string, string[]> = {
  USD: ["usd", "us dollar", "u.s. dollar", "greenback", "dxy", "federal reserve", "fed ", "fed's", "fomc", "powell", "u.s.", "us economy", "nonfarm", "non-farm", "nfp", "us cpi", "us inflation", "treasury yields", "wall street"],
  EUR: ["eur", "euro", "ecb", "lagarde", "eurozone", "euro area", "germany", "german", "bund", "france", "italy"],
  GBP: ["gbp", "pound", "sterling", "bank of england", "boe", "bailey", "uk ", "u.k.", "britain", "british", "gilt"],
  JPY: ["jpy", "yen", "bank of japan", "boj", "ueda", "japan", "japanese", "jgb"],
  CHF: ["chf", "swiss franc", "franc", "snb", "swiss national bank", "switzerland", "schlegel"],
  AUD: ["aud", "aussie", "australian dollar", "rba", "reserve bank of australia", "australia", "bullock"],
  CAD: ["cad", "loonie", "canadian dollar", "bank of canada", "boc", "canada", "macklem", "crude oil", "wti"],
  NZD: ["nzd", "kiwi", "new zealand dollar", "rbnz", "reserve bank of new zealand", "new zealand"],
  MXN: ["mxn", "mexican peso", "banxico", "mexico"],
  CNH: ["cnh", "cny", "yuan", "renminbi", "pboc", "china", "chinese"],
  SGD: ["sgd", "singapore dollar", "mas ", "singapore"],
  HKD: ["hkd", "hong kong dollar", "hkma", "hong kong"],
  ZAR: ["zar", "rand", "sarb", "south africa"],
  TRY: ["lira", "cbrt", "turkey", "turkish", "türkiye"],
  SEK: ["sek", "krona", "riksbank", "sweden", "swedish"],
  NOK: ["nok", "krone", "norges bank", "norway", "norwegian"],
  PLN: ["pln", "zloty", "nbp", "poland", "polish"],
  INR: ["inr", "rupee", "rbi", "reserve bank of india", "india", "indian"],
  THB: ["thb", "baht", "bank of thailand", "thailand", "thai"],
  PHP: ["php", "philippine peso", "bsp", "bangko sentral", "philippines", "philippine"],
};
