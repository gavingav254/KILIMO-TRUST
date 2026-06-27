import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLang } from "../lib/store";
import { t } from "../lib/i18n";
import { TOP_20_FERTILIZERS, FertilizerProfile } from "../lib/top20_fertilizers";
import { playAudio } from "./__root";
import { 
  ArrowLeft, 
  Volume2, 
  CheckCircle2, 
  AlertOctagon, 
  Clock, 
  ArrowRight, 
  Database, 
  ExternalLink,
  ShieldCheck,
  TrendingDown,
  RefreshCw,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const resultSearchSchema = z.object({
  id: z.string().optional(),
  caseId: z.string().optional(),
  status: z.string().optional(),
});

export const Route = createFileRoute("/result")({
  validateSearch: (search) => resultSearchSchema.parse(search),
  component: ResultView,
});

function ResultView() {
  const [lang] = useLang();
  const navigate = useNavigate();
  const search = useSearch({ from: "/result" });
  
  const [profile, setProfile] = useState<FertilizerProfile | null>(null);
  const [escalation, setEscalation] = useState<{
    status: "PENDING" | "RESOLVED";
    ui_state: "GREEN" | "AMBER" | "RED";
    verdict?: "SAFE" | "UNSAFE";
    notes?: string;
    estimated_minutes: number;
    queue_pos: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!lang) return;

    const loadData = async () => {
      setLoading(true);
      
      const isOffline = localStorage.getItem("kilimo.offline_sim") === "true";

      // 1. Case A: Masumi Escalation View
      if (search.caseId) {
        setEscalation({
          status: "PENDING",
          ui_state: "AMBER",
          estimated_minutes: 15,
          queue_pos: 2,
        });

        // Play Swahili/vernacular "sent to agronomist" notice
        playAudio(`/audio/${lang}/escalation_sent_${lang}.mp3`);

        if (!isOffline) {
          try {
            const res = await fetch(`http://localhost:3001/api/v1/escalation/${search.caseId}`);
            if (res.ok) {
              const data = await res.json();
              if (data.status === "RESOLVED") {
                setEscalation({
                  status: "RESOLVED",
                  ui_state: data.ui_state,
                  verdict: data.expert_verdict,
                  notes: data.expert_notes,
                  estimated_minutes: 0,
                  queue_pos: 0,
                });
                
                playAudio(
                  data.ui_state === "GREEN"
                    ? `/audio/${lang}/generic_safe_${lang}.mp3`
                    : `/audio/${lang}/generic_danger_${lang}.mp3`
                );
              }
            }
          } catch (e) {
            console.log("Offline or server down, polling skipped.");
          }
        }
        setLoading(false);
        return;
      }

      // 2. Case B: Direct Fertilizer Profile View
      if (search.id) {
        const localMatch = TOP_20_FERTILIZERS.find((f) => f.id === search.id);
        
        if (localMatch) {
          setProfile(localMatch);
          
          const audioPath = localMatch.audio_files[lang] || localMatch.audio_file_path;
          playAudio(audioPath);
        } else {
          toast.error("Fertilizer not found in local cache.");
        }
      }
      setLoading(false);
    };

    loadData();
  }, [search.id, search.caseId, lang]);

  if (!lang) return null;

  // Poll simulation for demo agronomist verdict
  const simulateExpertVerdict = async (verdict: "SAFE" | "UNSAFE") => {
    setLoading(true);
    
    // Attempt to notify server of simulation change so server and client sync!
    if (search.caseId) {
      try {
        await fetch(`http://localhost:3001/api/v1/expert/cases/${search.caseId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verdict,
            notes: verdict === "SAFE" 
              ? "Thibitisho la Mtaalamu: Mbolea hii imehakikiwa kuwa haina madini ya Cadmium juu ya viwango vya EU (imepimwa 4 ppm). Salama kutumiwa kwa mazao ya kuuza nje."
              : "Thibitisho la Mtaalamu: Hatari! Mbolea hii imepatikana kuwa na Cadmium zaidi ya kikomo cha EU. Usitumie kwenye kahawa, maharagwe ya kuuza nje.",
            safe_alternative_id: verdict === "UNSAFE" ? "mavuno_planting_04" : null
          })
        });
      } catch (e) {
        // Mock offline resolver
      }
    }

    setTimeout(() => {
      setLoading(false);
      setEscalation({
        status: "RESOLVED",
        ui_state: verdict === "SAFE" ? "GREEN" : "RED",
        verdict,
        notes: verdict === "SAFE" 
          ? "Thibitisho la Mtaalamu: Mbolea hii imehakikiwa kuwa haina madini ya Cadmium juu ya viwango vya EU (imepimwa 4 ppm). Salama kutumiwa kwa mazao ya kuuza nje."
          : "Thibitisho la Mtaalamu: Hatari! Mbolea hii imepatikana kuwa na Cadmium zaidi ya kikomo cha EU. Usitumie kwenye kahawa, maharagwe ya kuuza nje.",
        estimated_minutes: 0,
        queue_pos: 0,
      });

      playAudio(
        verdict === "SAFE"
          ? `/audio/${lang}/generic_safe_${lang}.mp3`
          : `/audio/${lang}/generic_danger_${lang}.mp3`
      );

      // Update local readiness score
      const savedScore = localStorage.getItem("kilimo_export_score") || "50";
      const score = parseInt(savedScore, 10);
      const impact = verdict === "SAFE" ? 5 : -10;
      localStorage.setItem("kilimo_export_score", String(Math.max(0, Math.min(100, score + impact))));

      // Also update matching case in scan history
      const savedHistory = localStorage.getItem("kilimo_scan_history");
      if (savedHistory && search.caseId) {
        const list = JSON.parse(savedHistory);
        const match = list.find((x: any) => x.id === search.caseId);
        if (match) {
          match.risk_status = verdict === "SAFE" ? "GREEN" : "RED";
          match.brand_name = verdict === "SAFE" ? "Verified safe by Expert" : "Flagged unsafe by Expert";
          localStorage.setItem("kilimo_scan_history", JSON.stringify(list));
        }
      }

      toast.success(`Expert verdict simulated: ${verdict}`);
    }, 1200);
  };

  const handleToggleAudio = () => {
    if (profile) {
      const audioPath = profile.audio_files[lang] || profile.audio_file_path;
      playAudio(audioPath);
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 5000);
    } else if (escalation && escalation.status === "RESOLVED") {
      playAudio(
        escalation.ui_state === "GREEN"
          ? `/audio/${lang}/generic_safe_${lang}.mp3`
          : `/audio/${lang}/generic_danger_${lang}.mp3`
      );
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 5000);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-6 py-2">
      {/* Back button link */}
      <div>
        <Link
          to="/home"
          className="text-xs font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-700 flex items-center gap-1.5 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-3.5 py-2 rounded-xl active:scale-95 transition-all shadow-sm w-fit"
        >
          <ArrowLeft size={14} />
          <span>Nyumbani (Dashboard)</span>
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 gap-4">
          <RefreshCw className="animate-spin text-emerald-500" size={32} />
          <p className="text-xs text-slate-400">Loading details...</p>
        </div>
      ) : escalation ? (
        // ==========================================
        // MASUMI AGRONOMIST ESCALATION STATE (AMBER/RESOLVED)
        // ==========================================
        <div className="space-y-5">
          {escalation.status === "PENDING" ? (
            <div className="bg-gradient-to-br from-amber-500 to-amber-600 border border-amber-600 text-white rounded-3xl p-6 shadow-md text-center relative overflow-hidden">
              <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 text-9xl">
                ⚠️
              </div>
              <Clock className="mx-auto mb-3 animate-pulse" size={44} />
              <h3 className="text-xl font-black">{t(lang, "amber")}</h3>
              <p className="text-xs text-amber-100 mt-2 max-w-xs mx-auto leading-relaxed">
                Mbolea hii haikutambuliwa moja kwa moja. Picha imetumwa kwa wataalamu wa Kilimo Trust ili wahakikishe.
              </p>
              
              <div className="grid grid-cols-2 gap-4 mt-6 pt-5 border-t border-white/20 text-xs">
                <div className="bg-white/10 p-2.5 rounded-xl">
                  <span className="block text-[10px] text-amber-200 font-semibold uppercase">Queue Position</span>
                  <span className="text-lg font-black mt-0.5">#{escalation.queue_pos}</span>
                </div>
                <div className="bg-white/10 p-2.5 rounded-xl">
                  <span className="block text-[10px] text-amber-200 font-semibold uppercase">Est. Response</span>
                  <span className="text-lg font-black mt-0.5">{escalation.estimated_minutes} min</span>
                </div>
              </div>
            </div>
          ) : (
            <div className={`border rounded-3xl p-6 shadow-md text-center relative overflow-hidden ${
              escalation.ui_state === "GREEN" 
                ? "bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-600 text-white"
                : "bg-gradient-to-br from-rose-500 to-rose-600 border-rose-600 text-white"
            }`}>
              {escalation.ui_state === "GREEN" ? (
                <>
                  <CheckCircle2 className="mx-auto mb-3" size={44} />
                  <h3 className="text-xl font-black">{t(lang, "green")}</h3>
                  <p className="text-xs text-emerald-100 mt-2 max-w-xs mx-auto leading-relaxed">
                    Wataalamu wamehakiki na kupitisha kuwa salama!
                  </p>
                </>
              ) : (
                <>
                  <AlertOctagon className="mx-auto mb-3" size={44} />
                  <h3 className="text-xl font-black">{t(lang, "red")}</h3>
                  <p className="text-xs text-rose-100 mt-2 max-w-xs mx-auto leading-relaxed">
                    Wataalamu wamehakiki na kukataa mbolea hii.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Expert Notes Card */}
          <div className="bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-3xl p-5 shadow-sm">
            <h4 className="font-extrabold text-sm text-slate-800 dark:text-zinc-200 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <ShieldCheck className="text-emerald-500" size={16} />
              <span>Maoni ya Agronomist (Expert Review)</span>
            </h4>
            <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed font-medium bg-slate-50 dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-850">
              {escalation.notes || "Inasubiri maoni ya mtaalamu... Maoni yatasasishwa hapa hivi karibuni."}
            </p>

            {escalation.status === "RESOLVED" && (
              <button 
                onClick={handleToggleAudio}
                className="w-full mt-4 flex items-center justify-center gap-2 p-3 bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-xl font-bold text-xs active:scale-95 transition-all text-slate-700 dark:text-zinc-300"
              >
                <Volume2 size={16} />
                <span>Sikiliza Maoni ya Wataalamu (Play Voice note)</span>
              </button>
            )}
          </div>

          {/* TESTING: Simulation controls for Masumi queue status */}
          {escalation.status === "PENDING" && (
            <div className="bg-amber-55/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-3xl p-4 mt-6">
              <h5 className="text-xs font-bold text-amber-800 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                <Sparkles size={14} />
                <span>Presentation Sandbox Simulator</span>
              </h5>
              <p className="text-[10px] text-amber-750 dark:text-amber-500 leading-normal mb-3">
                Agronomist queue is simulated. Click below to mimic a real-time response from the expert dashboard:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => simulateExpertVerdict("SAFE")}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[10px] p-2.5 rounded-xl active:scale-95 transition-all"
                >
                  Simulate APPROVAL (GREEN)
                </button>
                <button
                  onClick={() => simulateExpertVerdict("UNSAFE")}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-[10px] p-2.5 rounded-xl active:scale-95 transition-all"
                >
                  Simulate REJECTION (RED)
                </button>
              </div>
            </div>
          )}
        </div>
      ) : profile ? (
        // ==========================================
        // DIRECT FERTILIZER PROFILE VIEW STATE
        // ==========================================
        <div className="space-y-5">
          {/* Main Compliance Banner */}
          <div className={`border rounded-3xl p-6 shadow-md text-center relative overflow-hidden ${
            profile.risk_status === "GREEN" 
              ? "bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-600 text-white" :
            profile.risk_status === "RED" 
              ? "bg-gradient-to-br from-rose-500 to-rose-600 border-rose-600 text-white" :
              "bg-gradient-to-br from-amber-500 to-amber-600 border-amber-600 text-white"
          }`}>
            <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 text-9xl">
              {profile.risk_status === "GREEN" ? "✅" : profile.risk_status === "RED" ? "❌" : "⚠️"}
            </div>
            
            {profile.risk_status === "GREEN" ? (
              <CheckCircle2 className="mx-auto mb-3" size={44} />
            ) : profile.risk_status === "RED" ? (
              <AlertOctagon className="mx-auto mb-3" size={44} />
            ) : (
              <Clock className="mx-auto mb-3" size={44} />
            )}

            <h3 className="text-xl font-black">
              {profile.brand_name}
            </h3>
            
            <p className="text-xs font-bold text-white/95 mt-1 tracking-wider uppercase">
              NPK: {profile.npk} &bull; {
                profile.risk_status === "GREEN" ? t(lang, "green") :
                profile.risk_status === "RED" ? t(lang, "red") : t(lang, "amber")
              }
            </p>
          </div>

          {/* Audio Player Card */}
          <div className="bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-3xl p-5 shadow-sm">
            <h4 className="font-extrabold text-xs text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-3">
              Vernacular Audio Advisory
            </h4>
            
            <div className="flex items-center gap-4 bg-slate-50 dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800/80 p-3 rounded-2xl">
              <button
                onClick={handleToggleAudio}
                className="h-12 w-12 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 transition-all text-white flex items-center justify-center flex-shrink-0"
              >
                <Volume2 size={22} className={isPlaying ? "animate-bounce" : ""} />
              </button>

              <div className="flex-1 min-w-0">
                <span className="block text-xs font-black text-slate-800 dark:text-zinc-200">
                  {isPlaying ? "Sasa inacheza..." : "Sikiliza ushauri sasa"}
                </span>
                <span className="block text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 uppercase font-bold tracking-widest">
                  Language: {lang.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          {/* Advisory description */}
          <div className="bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-3xl p-5 shadow-sm">
            <h4 className="font-extrabold text-xs text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
              Maelezo ya Kina (Advisory Detail)
            </h4>
            <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200 leading-relaxed">
              {lang === "en" ? profile.reason_en : profile.reason_sw}
            </p>

            <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-zinc-850 flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">EU Regulation Ref:</span>
                <span className="font-bold text-slate-700 dark:text-zinc-200">{profile.regulation_ref}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Recommended Crops:</span>
                <span className="font-bold text-slate-700 dark:text-zinc-200 capitalize">
                  {profile.common_crops.join(", ")}
                </span>
              </div>
            </div>
          </div>

          {/* Chemical breakdown */}
          <div className="bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-3xl p-5 shadow-sm">
            <h4 className="font-extrabold text-xs text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-3">
              Ingredient Compliance Limits
            </h4>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-zinc-300 mb-1.5">
                  <span>Cadmium level:</span>
                  <span className="font-extrabold">
                    {profile.cadmium_ppm} ppm / limit: {profile.eu_cadmium_limit_ppm} ppm
                  </span>
                </div>
                <div className="h-3 w-full bg-slate-100 dark:bg-zinc-900 border border-slate-200/50 dark:border-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      profile.cadmium_ppm > profile.eu_cadmium_limit_ppm 
                        ? "bg-rose-500" 
                        : profile.cadmium_ppm > 40 
                        ? "bg-amber-500" 
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, (profile.cadmium_ppm / 100) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-100 dark:border-zinc-850">
                <span className="text-slate-500 font-semibold">Phosphonates detected:</span>
                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                  profile.phosphonate 
                    ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" 
                    : "bg-emerald-100 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400"
                }`}>
                  {profile.phosphonate ? "YES (BANNED)" : "NO (COMPLIANT)"}
                </span>
              </div>
            </div>
          </div>

          {/* Safe alternatives list */}
          {(profile.risk_status === "RED" || profile.risk_status === "AMBER") && (
            <div className="space-y-3">
              <h4 className="font-extrabold text-xs text-slate-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingDown size={14} className="text-emerald-500" />
                <span>Mbadala Salama Inayopendekezwa (Safe Alternatives)</span>
              </h4>

              <div className="space-y-2">
                {profile.safe_alternative_ids.map((altId) => {
                  const altObj = TOP_20_FERTILIZERS.find((f) => f.id === altId);
                  if (!altObj) return null;
                  return (
                    <Link
                      key={altId}
                      to="/result"
                      search={{ id: altId }}
                      className="flex items-center justify-between p-3.5 bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100/50 dark:border-emerald-900/50 hover:border-emerald-500 rounded-2xl cursor-pointer active:scale-[0.99] transition-all text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                        <h5 className="font-bold text-xs text-slate-800 dark:text-zinc-200">
                          {altObj.brand_name}
                        </h5>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-500">
                        View Alt &rarr;
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center p-20 bg-white dark:bg-zinc-800 border rounded-3xl">
          <p className="text-sm text-slate-400">Invalid parameters specified.</p>
        </div>
      )}
    </div>
  );
}
