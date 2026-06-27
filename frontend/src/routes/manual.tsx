import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useLang } from "../lib/store";
import { t } from "../lib/i18n";
import { TOP_20_FERTILIZERS } from "../lib/top20_fertilizers";
import { playAudio } from "./__root";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/manual")({
  component: ManualEntryFlow,
});

// Supported bag colors
const BAG_COLORS = [
  { name: "white", css: "bg-white border-slate-300" },
  { name: "blue", css: "bg-blue-600 border-blue-800 text-white" },
  { name: "yellow", css: "bg-yellow-400 border-yellow-500" },
  { name: "green", css: "bg-emerald-600 border-emerald-800 text-white" },
  { name: "brown", css: "bg-amber-800 border-amber-900 text-white" },
  { name: "grey", css: "bg-gray-500 border-gray-600 text-white" },
  { name: "pink", css: "bg-pink-400 border-pink-500" },
  { name: "red", css: "bg-red-600 border-red-800 text-white" },
  { name: "black", css: "bg-zinc-900 border-zinc-950 text-white" },
  { name: "gold", css: "bg-amber-500 border-amber-600" },
];

// Major brands for logo selection
const BRANDS = [
  { id: "YARA", name: "Yara", icon: "🇳🇴", desc: "YaraMila / YaraBela" },
  { id: "MAVUNO", name: "Mavuno", icon: "🌱", desc: "Mavuno Fertilizers" },
  { id: "BARAKA", name: "Baraka", icon: "🌾", desc: "Baraka NPK" },
  { id: "SIGMA", name: "Sigma", icon: "📐", desc: "Sigma NPKS" },
  { id: "GENERIC_DAP", name: "DAP", icon: "🟤", desc: "Di-Ammonium Phosphate" },
  { id: "GENERIC_CAN", name: "CAN", icon: "⚪", desc: "Calcium Ammonium Nitrate" },
  { id: "GENERIC_UREA", name: "Urea", icon: "💧", desc: "Urea 46% N" },
  { id: "ORGANICS", name: "Organics", icon: "♻️", desc: "Organics Plus / Bio Mazao" },
];

function ManualEntryFlow() {
  const [lang] = useLang();
  const navigate = useNavigate();
  const search: { caseId?: string } = useSearch({ from: "/manual" });
  const caseId = search.caseId || crypto.randomUUID();

  // Step states
  const [step, setStep] = useState(1);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [batchCode, setBatchCode] = useState("");

  if (!lang) return null;

  const handleNextStep = () => {
    if (step < 3) {
      setStep(step + 1);
      playAudio(`/audio/${lang}/next_${lang}.mp3`);
    } else {
      handleSubmit();
    }
  };

  const handleBackStep = () => {
    if (step > 1) {
      setStep(step - 1);
      playAudio(`/audio/${lang}/back_${lang}.mp3`);
    } else {
      navigate({ to: "/home" });
    }
  };

  // Custom numeric keypad logic
  const handleKeypadPress = (val: string) => {
    if (val === "CLEAR") {
      setBatchCode("");
    } else if (val === "BACKSPACE") {
      setBatchCode(batchCode.slice(0, -1));
    } else {
      if (batchCode.length < 12) {
        setBatchCode(batchCode + val);
      }
    }
  };

  // Submit flow
  const handleSubmit = async () => {
    toast.info("Verifying manual input against EU regulations...");

    const payload = {
      bag_color: selectedColor,
      brand_id: selectedBrand,
      batch_number: batchCode || null,
      lang,
      device_id: getDeviceId(),
      case_id: caseId,
    };

    const isOffline = localStorage.getItem("kilimo.offline_sim") === "true";

    if (isOffline) {
      processOfflineMatch();
    } else {
      try {
        const res = await fetch("http://localhost:3001/api/v1/fertilizers/manual", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        
        if (data.success && data.profile) {
          const profile = data.profile;
          updateScore(data.export_score_impact || 0);
          saveScanToHistory(profile.id, profile.brand_name, profile.risk_status);
          navigate({ to: "/result", search: { id: profile.id } });
        } else {
          // Escalated on server
          saveScanToHistory(caseId, `Manual Query (${selectedBrand || "Unknown"})`, "AMBER");
          navigate({ to: "/result", search: { caseId, status: "AMBER" } });
        }
      } catch (err) {
        console.warn("Server connection failed. Using local database search.", err);
        processOfflineMatch();
      }
    }
  };

  const getDeviceId = () => {
    let id = localStorage.getItem("kilimo_device_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("kilimo_device_id", id);
    }
    return id;
  };

  const updateScore = (impact: number) => {
    const savedScore = localStorage.getItem("kilimo_export_score") || "50";
    const score = parseInt(savedScore, 10);
    const newScore = Math.max(0, Math.min(100, score + impact));
    localStorage.setItem("kilimo_export_score", String(newScore));
  };

  const saveScanToHistory = (id: string, name: string, status: "GREEN" | "AMBER" | "RED") => {
    const saved = localStorage.getItem("kilimo_scan_history");
    const history = saved ? JSON.parse(saved) : [];
    const item = {
      id,
      brand_name: name,
      risk_status: status,
      timestamp: new Date().toISOString(),
    };
    const updated = [item, ...history.slice(0, 9)];
    localStorage.setItem("kilimo_scan_history", JSON.stringify(updated));
  };

  // Local database offline matcher
  const processOfflineMatch = () => {
    // 1. Try search by batch code keywords first
    let matchedProfile = null;
    
    if (batchCode) {
      matchedProfile = TOP_20_FERTILIZERS.find((f) => 
        f.batch_prefix_keywords.some((kw) => batchCode.toUpperCase().includes(kw)) ||
        f.id.toLowerCase().includes(batchCode.toLowerCase())
      );
    }

    // 2. If no batch match, try color + brand combo
    if (!matchedProfile && selectedBrand) {
      const brandMatches = TOP_20_FERTILIZERS.filter((f) => 
        f.brand_name.toLowerCase().includes(selectedBrand.toLowerCase()) || 
        f.batch_prefix_keywords.some((kw) => kw === selectedBrand)
      );

      if (brandMatches.length > 0) {
        if (selectedColor) {
          // Try to match color as well
          matchedProfile = brandMatches.find((f) => f.bag_colors.includes(selectedColor)) || brandMatches[0];
        } else {
          matchedProfile = brandMatches[0];
        }
      }
    }

    // 3. Fallback color-only match
    if (!matchedProfile && selectedColor) {
      const colorMatches = TOP_20_FERTILIZERS.filter((f) => f.bag_colors.includes(selectedColor));
      if (colorMatches.length > 0) {
        matchedProfile = colorMatches[0];
      }
    }

    if (matchedProfile) {
      toast.success(`Offline Match: "${matchedProfile.brand_name}"`);
      const impact = matchedProfile.risk_status === "GREEN" ? 5 : matchedProfile.risk_status === "RED" ? -10 : 0;
      updateScore(impact);
      saveScanToHistory(matchedProfile.id, matchedProfile.brand_name, matchedProfile.risk_status);
      navigate({ to: "/result", search: { id: matchedProfile.id } });
    } else {
      // Escalate offline to be synced later
      toast.warning("Fertilizer not in offline database. Queuing for expert verification.");
      playAudio(`/audio/${lang}/escalation_sent_${lang}.mp3`);
      
      saveScanToHistory(caseId, `Manual Input (Bag: ${selectedColor || "None"}, Brand: ${selectedBrand || "None"})`, "AMBER");
      
      // Save offline packet to indexDB or localStorage outbox
      const outbox = localStorage.getItem("kilimo_outbox") ? JSON.parse(localStorage.getItem("kilimo_outbox")!) : [];
      outbox.push({
        case_id: caseId,
        device_id: getDeviceId(),
        bag_color: selectedColor,
        brand_id: selectedBrand,
        batch_number: batchCode,
        created_at: new Date().toISOString(),
      });
      localStorage.setItem("kilimo_outbox", JSON.stringify(outbox));

      // Trigger SW message queue notification
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "QUEUE_ESCALATION",
          payload: { case_id: caseId, device_id: getDeviceId() }
        });
      }

      navigate({ to: "/result", search: { caseId, status: "AMBER" } });
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between py-2">
      {/* Progress Header */}
      <div>
        <div className="flex items-center justify-between px-2 mb-3">
          <button 
            onClick={handleBackStep}
            className="text-xs font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-700 flex items-center gap-1 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-3 py-1.5 rounded-xl active:scale-95 transition-all"
          >
            <ArrowLeft size={14} />
            <span>{t(lang, "back")}</span>
          </button>
          <span className="text-xs font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
            Step {step} of 3
          </span>
        </div>

        {/* Progress bar line */}
        <div className="h-2 w-full bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-6">
          <div 
            className="h-full bg-emerald-500 transition-all duration-300 rounded-full" 
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </div>

      {/* Main Flow Content */}
      <div className="flex-1 flex flex-col justify-start">
        
        {/* Step 1: Bag Color */}
        {step === 1 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="text-center">
              <h3 className="text-xl font-black text-slate-800 dark:text-zinc-100">
                {t(lang, "bagColor")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Tazama gunia la mbolea kisha uchague rangi yake
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              {BAG_COLORS.map((col) => {
                const isSelected = selectedColor === col.name;
                return (
                  <button
                    key={col.name}
                    onClick={() => {
                      setSelectedColor(col.name);
                      playAudio(`/audio/${lang}/select_click_${lang}.mp3`);
                    }}
                    className={`h-24 rounded-2xl border-2 p-3 text-left relative flex flex-col justify-between transition-all duration-150 active:scale-[0.97] ${col.css} ${
                      isSelected 
                        ? "ring-4 ring-emerald-500 scale-[1.02] border-transparent" 
                        : "hover:scale-[1.01]"
                    }`}
                  >
                    <span className="font-extrabold text-xs tracking-wider uppercase drop-shadow-sm">
                      {col.name}
                    </span>
                    {isSelected && (
                      <span className="absolute bottom-3 right-3 bg-emerald-500 text-white rounded-full p-1 border border-white">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Brand Logo */}
        {step === 2 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="text-center">
              <h3 className="text-xl font-black text-slate-800 dark:text-zinc-100">
                {t(lang, "brand")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Chagua jina au alama ya chapa ya mbolea hii
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              {BRANDS.map((br) => {
                const isSelected = selectedBrand === br.id;
                return (
                  <button
                    key={br.id}
                    onClick={() => {
                      setSelectedBrand(br.id);
                      playAudio(`/audio/${lang}/select_click_${lang}.mp3`);
                    }}
                    className={`h-28 rounded-2xl border p-4 bg-white dark:bg-zinc-800 text-left flex flex-col justify-between transition-all active:scale-[0.97] ${
                      isSelected 
                        ? "border-emerald-500 ring-4 ring-emerald-500/20 scale-[1.02]" 
                        : "border-slate-200 dark:border-zinc-700 hover:scale-[1.01]"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-2xl">{br.icon}</span>
                      {isSelected && (
                        <span className="bg-emerald-500 text-white rounded-full p-0.5">
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-sm text-slate-800 dark:text-zinc-100">{br.name}</h4>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 leading-none">{br.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Numeric Keypad */}
        {step === 3 && (
          <div className="space-y-4 animate-fadeIn flex-1 flex flex-col justify-between">
            <div className="text-center">
              <h3 className="text-xl font-black text-slate-800 dark:text-zinc-100">
                {t(lang, "batch")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Chapa au uandike nambari ya bechi iliyopo juu ya gunia
              </p>
            </div>

            {/* Display screen */}
            <div className="bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-center my-3 min-h-[64px] flex items-center justify-center relative">
              <span className="text-2xl font-black tracking-widest text-slate-800 dark:text-zinc-50 font-mono">
                {batchCode || "---- ---- ----"}
              </span>
              {batchCode && (
                <button
                  onClick={() => handleKeypadPress("CLEAR")}
                  className="absolute right-3 p-1.5 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-500"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>

            {/* Large 3x4 Touch Keypad */}
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto w-full mt-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num)}
                  className="h-14 bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700 active:scale-95 text-xl font-extrabold text-slate-800 dark:text-zinc-100 border border-slate-200 dark:border-zinc-700 rounded-xl transition-all flex items-center justify-center"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => handleKeypadPress("BACKSPACE")}
                className="h-14 bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 active:scale-95 text-sm font-bold text-slate-500 dark:text-zinc-400 border border-slate-200/50 dark:border-zinc-800 rounded-xl transition-all flex items-center justify-center"
              >
                DEL
              </button>
              <button
                onClick={() => handleKeypadPress("0")}
                className="h-14 bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700 active:scale-95 text-xl font-extrabold text-slate-800 dark:text-zinc-100 border border-slate-200 dark:border-zinc-700 rounded-xl transition-all flex items-center justify-center"
              >
                0
              </button>
              <button
                onClick={() => handleKeypadPress("CLEAR")}
                className="h-14 bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 active:scale-95 text-xs font-bold text-slate-500 dark:text-zinc-400 border border-slate-200/50 dark:border-zinc-800 rounded-xl transition-all flex items-center justify-center"
              >
                CLEAR
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Navigation Buttons footer */}
      <div className="mt-8 pt-4 border-t border-slate-100 dark:border-zinc-800 flex items-center gap-3">
        <button
          onClick={handleBackStep}
          className="flex-1 py-4 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 font-bold rounded-2xl active:scale-95 transition-all text-sm"
        >
          {t(lang, "back")}
        </button>

        <button
          onClick={handleNextStep}
          disabled={step === 1 && !selectedColor}
          className={`flex-1 py-4 text-white font-extrabold rounded-2xl active:scale-95 transition-all text-sm flex items-center justify-center gap-1.5 ${
            step === 1 && !selectedColor
              ? "bg-slate-300 dark:bg-zinc-800 text-slate-500 dark:text-zinc-600 cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-500 shadow-md"
          }`}
        >
          <span>{step === 3 ? t(lang, "next") : t(lang, "next")}</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
