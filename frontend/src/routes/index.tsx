import { createFileRoute, Link } from "@tanstack/react-router";
import { useLang } from "../lib/store";
import { LANGUAGES, T } from "../lib/i18n";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LanguageSelector,
});

function LanguageSelector() {
  const [, setLang] = useLang();

  return (
    <div className="flex-1 flex flex-col justify-between py-6">
      {/* Hero Welcome */}
      <div className="text-center my-auto px-4">
        <div className="inline-flex p-4 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-500 mb-6 scale-110 shadow-inner">
          <span className="text-5xl animate-bounce">🌱</span>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
          Kilimo Trust
        </h2>
        <p className="mt-3 text-slate-600 dark:text-zinc-400 text-sm max-w-sm mx-auto leading-relaxed">
          "Piga picha au sema, jua hatari kabla ya kutumia."
        </p>
        <p className="mt-1 text-slate-400 dark:text-zinc-500 text-xs italic">
          (Scan or speak — know the risk before you apply.)
        </p>
      </div>

      {/* Language Selection Grid */}
      <div className="space-y-4 w-full px-2 mt-8">
        <h3 className="text-center text-sm font-semibold text-slate-500 dark:text-zinc-400 tracking-wider uppercase">
          Choose your language / Chagua lugha
        </h3>
        
        <div className="grid gap-3 mt-4">
          {LANGUAGES.map((l) => (
            <Link
              key={l.code}
              to="/home"
              onClick={() => setLang(l.code)}
              className="w-full flex items-center justify-between p-4 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl hover:border-emerald-500 dark:hover:border-emerald-500 shadow-sm hover:shadow-md active:scale-[0.98] hover:scale-[1.01] transition-all text-left duration-200"
            >
              <div className="flex items-center gap-4">
                <span className="text-3xl bg-slate-50 dark:bg-zinc-900 p-2 rounded-xl shadow-inner">{l.flag}</span>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-100 text-base">{l.native}</h4>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    {l.name} &bull; {T[l.code].tap}
                  </p>
                </div>
              </div>
              <div className="p-1.5 rounded-full bg-slate-50 dark:bg-zinc-900 text-slate-400">
                <ChevronRight size={18} />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer Info */}
      <div className="text-center mt-12 text-xs text-slate-400 dark:text-zinc-500">
        <p>EU Fertilizing Regulations Compliance Checker</p>
        <p className="mt-1">Kenya AI Challenge &bull; AgriFin Track</p>
      </div>
    </div>
  );
}
