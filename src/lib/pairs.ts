export type PairCategory = "major" | "minor" | "exotic";

export interface ForexPair {
  symbol: string; // e.g. EURUSD
  base: string;
  quote: string;
  category: PairCategory;
  nickname?: string;
  popularity: number; // 1 = most traded
}

const p = (
  symbol: string,
  category: PairCategory,
  popularity: number,
  nickname?: string,
): ForexPair => ({
  symbol,
  base: symbol.slice(0, 3),
  quote: symbol.slice(3, 6),
  category,
  popularity,
  nickname,
});

export const PAIRS: ForexPair[] = [
  // Majors
  p("EURUSD", "major", 1, "Fiber"),
  p("USDJPY", "major", 2, "Gopher"),
  p("GBPUSD", "major", 3, "Cable"),
  p("AUDUSD", "major", 4, "Aussie"),
  p("USDCAD", "major", 5, "Loonie"),
  p("USDCHF", "major", 6, "Swissie"),
  p("NZDUSD", "major", 7, "Kiwi"),
  // Minors / crosses
  p("EURJPY", "minor", 8, "Yuppy"),
  p("GBPJPY", "minor", 9, "Guppy"),
  p("EURGBP", "minor", 10, "Chunnel"),
  p("AUDJPY", "minor", 11),
  p("EURCHF", "minor", 12, "Swissy cross"),
  p("EURAUD", "minor", 13),
  p("EURCAD", "minor", 14),
  p("GBPCHF", "minor", 15),
  p("GBPAUD", "minor", 16),
  p("CADJPY", "minor", 17),
  p("CHFJPY", "minor", 18),
  p("NZDJPY", "minor", 19),
  p("AUDNZD", "minor", 20),
  p("AUDCAD", "minor", 21),
  p("GBPCAD", "minor", 22),
  p("EURNZD", "minor", 23),
  p("GBPNZD", "minor", 24),
  p("AUDCHF", "minor", 25),
  p("NZDCAD", "minor", 26),
  p("NZDCHF", "minor", 27),
  p("CADCHF", "minor", 28),
  // Exotics
  p("USDMXN", "exotic", 29),
  p("USDCNH", "exotic", 30),
  p("USDSGD", "exotic", 31),
  p("USDHKD", "exotic", 32),
  p("USDZAR", "exotic", 33),
  p("USDTRY", "exotic", 34),
  p("USDSEK", "exotic", 35),
  p("USDNOK", "exotic", 36),
  p("USDPLN", "exotic", 37),
  p("USDINR", "exotic", 38),
  p("USDTHB", "exotic", 39),
  p("USDPHP", "exotic", 40),
  p("EURTRY", "exotic", 41),
  p("EURSEK", "exotic", 42),
  p("EURNOK", "exotic", 43),
  p("EURPLN", "exotic", 44),
];

export function getPair(symbol: string): ForexPair | undefined {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  return PAIRS.find((x) => x.symbol === s);
}

export const formatPair = (pair: ForexPair) => `${pair.base}/${pair.quote}`;

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CHF: "Swiss Franc",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  NZD: "New Zealand Dollar",
  MXN: "Mexican Peso",
  CNH: "Chinese Yuan (offshore)",
  SGD: "Singapore Dollar",
  HKD: "Hong Kong Dollar",
  ZAR: "South African Rand",
  TRY: "Turkish Lira",
  SEK: "Swedish Krona",
  NOK: "Norwegian Krone",
  PLN: "Polish Zloty",
  INR: "Indian Rupee",
  THB: "Thai Baht",
  PHP: "Philippine Peso",
};

export const CATEGORY_LABEL: Record<PairCategory, string> = {
  major: "Majors",
  minor: "Minors & Crosses",
  exotic: "Exotics",
};
