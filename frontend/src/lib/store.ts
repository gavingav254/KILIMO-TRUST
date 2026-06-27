import { useEffect, useState } from "react";
import type { Lang } from "./i18n";

const KEY = "kilimo.lang";

export function useLang(): [Lang | null, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang | null>(null);
  useEffect(() => {
    const v = typeof window !== "undefined" ? (localStorage.getItem(KEY) as Lang | null) : null;
    setLangState(v);
  }, []);
  const setLang = (l: Lang) => {
    localStorage.setItem(KEY, l);
    setLangState(l);
  };
  return [lang, setLang];
}

export function clearLang() {
  localStorage.removeItem(KEY);
}
