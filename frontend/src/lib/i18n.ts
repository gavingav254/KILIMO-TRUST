export type Lang = "sw" | "en" | "ki" | "luo" | "kal";

export const LANGUAGES: { code: Lang; name: string; native: string; flag: string }[] = [
  { code: "sw", name: "Swahili", native: "Kiswahili", flag: "🇰🇪" },
  { code: "en", name: "English", native: "English", flag: "🇬🇧" },
  { code: "ki", name: "Kikuyu", native: "Gĩkũyũ", flag: "🌾" },
  { code: "luo", name: "Dholuo", native: "Dholuo", flag: "🌊" },
  { code: "kal", name: "Kalenjin", native: "Kalenjin", flag: "⛰️" },
];

type Dict = Record<string, string>;

export const T: Record<Lang, Dict> = {
  sw: {
    choose: "Chagua lugha yako",
    scan: "Skani Lebo",
    speak: "Sema Jina",
    score: "Alama ya Uuzaji Nje",
    listen: "Sikiliza Ushauri",
    green: "SALAMA — Tayari Kuuza",
    amber: "ANGALIA — Hatua Zinahitajika",
    red: "USIUZE — Hatari",
    manual: "Ingiza kwa Mkono",
    bagColor: "Chagua rangi ya gunia",
    brand: "Chagua chapa",
    batch: "Andika nambari ya bechi",
    next: "Endelea",
    back: "Rudi",
    home: "Nyumbani",
    tap: "Bonyeza kuanza",
  },
  en: {
    choose: "Choose your language",
    scan: "Scan Label",
    speak: "Speak Name",
    score: "Export Ready Score",
    listen: "Listen to advice",
    green: "SAFE — Export Ready",
    amber: "CAUTION — Action Needed",
    red: "DO NOT SELL — Risk",
    manual: "Manual Entry",
    bagColor: "Pick bag color",
    brand: "Pick brand",
    batch: "Enter batch number",
    next: "Next",
    back: "Back",
    home: "Home",
    tap: "Tap to start",
  },
  ki: { choose: "Thuura rũthiomi rwaku", scan: "Thikania Lebo", speak: "Aria Rĩĩtwa", score: "Mũigana wa Kũendia", listen: "Thikĩrĩria", green: "NĨ KWĨGA — Wĩhaarĩirie", amber: "MENYA — Hĩndĩ ya Gwĩka", red: "NDŨGENDIE — Ũgwati", manual: "Andĩka na Guoko", bagColor: "Thuura rangi ya mũhuko", brand: "Thuura mwene", batch: "Andĩka namba", next: "Mbere", back: "Cooka", home: "Mũciĩ", tap: "Hutia wambĩrĩrie" },
  luo: { choose: "Yier dhok mari", scan: "Range Lebo", speak: "Wach Nying", score: "Kit Loso Oko", listen: "Winj Puonj", green: "BER — Oikore Loso", amber: "TANG — Tim Gimoro", red: "KIK ILOK — Hatari", manual: "Ndik gi Lwedo", bagColor: "Yier rangi mar ofuko", brand: "Yier ngat ma oloso", batch: "Ndik namba", next: "Dhi nyime", back: "Dog chien", home: "Dala", tap: "Mul mondo ichak" },
  kal: { choose: "Lewen ng'alekab", scan: "Sikani Lebo", speak: "Lel Kainet", score: "Mengotet ab Aldai", listen: "Kas Ng'alek", green: "KARARAN — Ki Aldai", amber: "RIB — Yache Kayanet", red: "MA IAL — Ng'omnatet", manual: "Sir ak Eun", bagColor: "Lewen rangit ab gunia", brand: "Lewen brand", batch: "Sir nambait", next: "Wendi", back: "Wendi let", home: "Got", tap: "Tach itesi" },
};

export const t = (lang: Lang, key: keyof typeof T["en"]) => T[lang][key] ?? T.en[key];
