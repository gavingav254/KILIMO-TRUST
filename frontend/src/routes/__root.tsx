import { createRootRoute, Outlet, ScrollRestoration, useNavigate, useLocation, HeadContent, Scripts, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLang, clearLang } from "../lib/store";
import { LANGUAGES, t } from "../lib/i18n";
import { Wifi, WifiOff, Globe, LogOut, ShieldAlert, Menu, X, Home, Keyboard, Settings, HelpCircle, UserCheck } from "lucide-react";
import { Toaster, toast } from "sonner";
import "../styles.css";

// Global audio helper
let currentAudio: HTMLAudioElement | null = null;

export const playAudio = (path: string) => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const audio = new Audio(path);
  currentAudio = audio;
  audio.play().catch((err) => {
    console.warn("Autoplay blocked by browser. User must interact to play audio.", err);
    toast.error("Tap to play audio guidance");
  });
};

export const Route = createRootRoute({
  meta: [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: "Kilimo Trust - Verify Fertilizer Compliance" },
    { name: "description", content: "Voice-first compliance checking for smallholder farmers" },
  ],
  links: [
    { rel: "manifest", href: "/manifest.webmanifest" },
    { rel: "icon", href: "/icon.svg" },
  ],
  notFoundComponent: () => {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center gap-5 my-auto">
        <span className="text-6xl animate-pulse">⚠️</span>
        <h2 className="text-2xl font-black text-slate-800 dark:text-zinc-100">
          Ukurasa Haukupatikana
        </h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-xs">
          The requested page could not be found. Please check the address or return to the main dashboard.
        </p>
        <Link 
          to="/home" 
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-bold shadow-md active:scale-95 transition-all"
        >
          Rudi Nyumbani (Back to Home)
        </Link>
      </div>
    );
  },
  component: RootComponent,
});

function RootComponent() {
  const [lang, setLang] = useLang();
  const [isSimulatedOffline, setIsSimulatedOffline] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Safeguard hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Register service worker and handle background sync messages
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) {
          navigator.serviceWorker.register("/sw.js").then((r) => {
            console.log("Service Worker registered successfully:", r.scope);
          }).catch((err) => {
            console.warn("Service Worker registration failed:", err);
          });
        }
      });

      const messageHandler = (event: MessageEvent) => {
        const { type, ...payload } = event.data;
        switch (type) {
          case "CACHE_UPDATE_AVAILABLE":
            toast.info(`New fertilizer database version available: ${payload.new_version}`);
            break;
          case "OUTBOX_SYNCED":
            toast.success("Offline scans successfully synced to Kilimo Trust cloud!");
            break;
          case "ESCALATION_QUEUED":
            toast.warning("Offline: Scan queued. Will send when internet is restored.");
            break;
          case "SIMULATE_OFFLINE_ACK":
            console.log("SW Offline Simulation status:", payload.enabled);
            break;
        }
      };

      navigator.serviceWorker.addEventListener("message", messageHandler);
      return () => {
        navigator.serviceWorker.removeEventListener("message", messageHandler);
      };
    }
  }, []);

  // Sync simulated offline state with service worker
  const handleToggleOffline = (enabled: boolean) => {
    setIsSimulatedOffline(enabled);
    localStorage.setItem("kilimo.offline_sim", enabled ? "true" : "false");
    
    if (typeof window !== "undefined" && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SIMULATE_OFFLINE",
        payload: { enabled },
      });
    }

    if (enabled) {
      toast.warning("⚡ Simulated Offline Mode Activated");
      if (lang) {
        playAudio(`/audio/${lang}/offline_sim_${lang}.mp3`);
      }
    } else {
      toast.success("🌐 Connected back to server");
    }
  };

  // Read saved offline simulation preference on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedOfflineSim = localStorage.getItem("kilimo.offline_sim") === "true";
      if (savedOfflineSim) {
        setTimeout(() => handleToggleOffline(true), 1000);
      }
    }
  }, []);

  // Redirect to language select if lang is missing, and restrict until hydration finishes
  useEffect(() => {
    if (!mounted) return;
    if (lang === null && location.pathname !== "/") {
      navigate({ to: "/" });
    } else if (lang !== null && location.pathname === "/") {
      navigate({ to: "/home" });
    }
  }, [lang, location.pathname, navigate, mounted]);

  const currentLangObj = LANGUAGES.find((l) => l.code === lang);

  return (
    <html lang={lang || "sw"}>
      <head>
        <HeadContent />
      </head>
      <body className="bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-zinc-50 min-h-screen flex flex-col font-sans transition-colors duration-200">
        {/* Top Header */}
        <header className="sticky top-0 z-50 backdrop-blur-md bg-white/85 dark:bg-zinc-900/85 border-b border-slate-200 dark:border-zinc-800 shadow-sm px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {lang && (
              <button 
                onClick={() => setIsMenuOpen(true)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 active:scale-95 transition-all"
                title="Open Menu"
              >
                <Menu size={22} />
              </button>
            )}
            
            <Link 
              to={lang ? "/home" : "/"} 
              className="flex items-center gap-2 cursor-pointer hover:opacity-90 active:scale-95 transition-all"
            >
              <span className="text-2xl">🌱</span>
              <div>
                <h1 className="font-black text-base tracking-tight text-emerald-600 dark:text-emerald-500 leading-none">
                  Kilimo Trust
                </h1>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 font-bold">AgriFin PWA</p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {/* Simulated Offline Toggle */}
            <button
              onClick={() => handleToggleOffline(!isSimulatedOffline)}
              className={`p-2 rounded-full border transition-all duration-200 ${
                isSimulatedOffline
                  ? "bg-amber-100 border-amber-300 text-amber-600 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400"
                  : "bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900 dark:text-emerald-400"
              }`}
              title={isSimulatedOffline ? "Disable Offline Simulation" : "Simulate Flight Mode"}
            >
              {isSimulatedOffline ? <WifiOff size={18} /> : <Wifi size={18} />}
            </button>

            {/* Language Selector Indicator */}
            {lang && (
              <button
                onClick={() => {
                  clearLang();
                  navigate({ to: "/" });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 text-xs font-semibold active:scale-95 transition-all text-slate-700 dark:text-zinc-300"
              >
                <span className="text-sm">{currentLangObj?.flag}</span>
                <span className="hidden xs:inline">{currentLangObj?.native}</span>
              </button>
            )}
          </div>
        </header>

        {/* Offline Banner */}
        {isSimulatedOffline && (
          <div className="bg-amber-500 text-black px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 shadow-sm animate-pulse">
            <ShieldAlert size={14} />
            <span>⚡ Deep Rural Mode — Serving from local cache</span>
          </div>
        )}

        {/* Sliding Navigation Drawer */}
        <div className={`fixed inset-0 z-50 flex transition-opacity duration-300 ease-out ${
          isMenuOpen && lang ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}>
          {/* Backdrop */}
          <div 
            onClick={() => setIsMenuOpen(false)}
            className="fixed inset-0 bg-black/55 backdrop-blur-xs"
          />
          
          {/* Drawer Panel */}
          <div className={`relative flex flex-col w-full max-w-[280px] bg-white dark:bg-zinc-800 h-full p-5 shadow-2xl border-r border-slate-100 dark:border-zinc-700 text-slate-800 dark:text-zinc-100 transition-transform duration-300 ease-out transform ${
            isMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}>
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🌾</span>
                <span className="font-extrabold text-lg text-emerald-600 dark:text-emerald-500">Kilimo Menu</span>
              </div>
              <button 
                onClick={() => setIsMenuOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            {/* Menu Links */}
            <nav className="flex-1 space-y-2">
              <Link
                to="/home"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-3.5 p-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 font-bold text-sm active:scale-[0.98] transition-all"
              >
                <Home size={18} className="text-emerald-500" />
                <span>Farmer Dashboard</span>
              </Link>

              <Link
                to="/manual"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-3.5 p-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 font-bold text-sm active:scale-[0.98] transition-all"
              >
                <Keyboard size={18} className="text-slate-500" />
                <span>Manual Lookup Form</span>
              </Link>

              <div className="border-t border-slate-100 dark:border-zinc-700 my-4" />

              <Link
                to="/home"
                search={{ expertView: "true" }}
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/15 border border-emerald-100/50 dark:border-emerald-900/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-bold text-sm active:scale-[0.98] transition-all"
              >
                <UserCheck size={18} className="text-emerald-600 dark:text-emerald-500" />
                <span>Expert Dashboard</span>
              </Link>
              
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  clearLang();
                  navigate({ to: "/" });
                }}
                className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl hover:bg-rose-50 dark:hover:bg-rose-950/10 text-rose-600 dark:text-rose-400 font-bold text-sm text-left active:scale-[0.98] transition-all"
              >
                <Globe size={18} />
                <span>Change Language</span>
              </button>
            </nav>

            {/* Menu Footer */}
            <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-auto flex items-center justify-between border-t border-slate-100 dark:border-zinc-700 pt-4">
              <span>PWA Version 1.0.0</span>
              <Link to="/home" className="hover:underline flex items-center gap-0.5">
                <HelpCircle size={10} />
                <span>Help</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 max-w-lg w-full mx-auto p-4 flex flex-col justify-start pb-20">
          <Outlet />
        </main>

        <Toaster position="bottom-center" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
