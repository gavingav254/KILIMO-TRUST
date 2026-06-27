import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useLang } from "../lib/store";
import { t } from "../lib/i18n";
import { TOP_20_FERTILIZERS, FertilizerProfile } from "../lib/top20_fertilizers";
import { 
  Camera, 
  Mic, 
  Keyboard, 
  History, 
  TrendingUp, 
  Award, 
  HelpCircle, 
  Volume2, 
  X, 
  Check, 
  AlertTriangle,
  Play,
  UserCheck,
  ClipboardList,
  AlertCircle,
  FileCheck,
  ArrowLeft
} from "lucide-react";
import { playAudio } from "./__root";
import { toast } from "sonner";
import { z } from "zod";

const homeSearchSchema = z.object({
  expertView: z.string().optional(),
});

export const Route = createFileRoute("/home")({
  validateSearch: (search) => homeSearchSchema.parse(search),
  component: DashboardController,
});

interface ScanHistoryItem {
  id: string;
  brand_name: string;
  risk_status: "GREEN" | "AMBER" | "RED";
  timestamp: string;
}

interface EscalationCase {
  case_id: string;
  device_id: string;
  brand_name?: string;
  batch_keywords?: string[];
  manual_batch?: string;
  status: "PENDING" | "RESOLVED";
  created_at: string;
  verdict?: "SAFE" | "UNSAFE";
  notes?: string;
}

function DashboardController() {
  const search = useSearch({ from: "/home" });
  const isExpertMode = search.expertView === "true";

  if (isExpertMode) {
    return <ExpertDashboard />;
  }
  return <FarmerDashboard />;
}

// ====================================================
// FARMER DASHBOARD COMPONENT
// ====================================================
function FarmerDashboard() {
  const [lang] = useLang();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // UI states
  const [score, setScore] = useState(50);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showScanSimulator, setShowScanSimulator] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Load score and history on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedScore = localStorage.getItem("kilimo_export_score");
      if (savedScore) {
        setScore(parseInt(savedScore, 10));
      } else {
        localStorage.setItem("kilimo_export_score", "50");
      }

      const savedHistory = localStorage.getItem("kilimo_scan_history");
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    }
  }, []);

  if (!lang) return null;

  // Sound triggers
  const handlePlayInstructions = () => {
    playAudio(`/audio/${lang}/welcome_${lang}.mp3`);
  };

  // Score description helper
  const getScoreStatus = () => {
    if (score >= 80) return { label: "Excellent (SACCO Loan Approved)", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20" };
    if (score >= 60) return { label: "Good (Eligible for Review)", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/20" };
    return { label: "Needs Improvement (Ineligible for Loan)", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/20" };
  };

  // OCR/Scan processor
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    toast.info("Processing photo using Featherless AI OCR...");
    
    // Check if offline
    const isOffline = localStorage.getItem("kilimo.offline_sim") === "true";
    if (isOffline) {
      setShowScanSimulator(true);
    } else {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("lang", lang);
      formData.append("device_id", getDeviceId());

      try {
        const response = await fetch("http://localhost:3001/api/v1/fertilizers/scan", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) throw new Error("Server error");
        
        const data = await response.json();
        
        if (data.fallback_required || !data.ocr_success) {
          toast.error("OCR failed to read the label. Opening manual form.");
          playAudio(`/audio/${lang}/ocr_failed_${lang}.mp3`);
          navigate({ to: "/manual", search: { caseId: data.case_id } });
          return;
        }

        if (data.triage === "ESCALATE") {
          saveScanToHistory({
            id: data.case_id,
            brand_name: "Unknown Fertilizer (Pending Expert Verification)",
            risk_status: "AMBER",
            timestamp: new Date().toISOString(),
          });
          navigate({ to: "/result", search: { caseId: data.case_id, status: "AMBER" } });
          return;
        }

        const profile = data.profile as FertilizerProfile;
        updateScore(data.export_score_impact);
        saveScanToHistory({
          id: profile.id,
          brand_name: profile.brand_name,
          risk_status: profile.risk_status,
          timestamp: new Date().toISOString(),
        });
        navigate({ to: "/result", search: { id: profile.id } });
      } catch (err) {
        console.warn("Server connection failed. Switching to offline simulator.", err);
        setShowScanSimulator(true);
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

  // Update SACCO ready score
  const updateScore = (impact: number) => {
    const newScore = Math.max(0, Math.min(100, score + impact));
    setScore(newScore);
    localStorage.setItem("kilimo_export_score", String(newScore));
  };

  // Add scan item to history
  const saveScanToHistory = (item: ScanHistoryItem) => {
    const updated = [item, ...history.slice(0, 9)];
    setHistory(updated);
    localStorage.setItem("kilimo_scan_history", JSON.stringify(updated));
  };

  // Simulate scan outcome
  const handleSimulateScanOutcome = async (type: "GREEN" | "AMBER_ESCALATE" | "RED" | "OCR_FAILED") => {
    setShowScanSimulator(false);
    
    if (type === "OCR_FAILED") {
      const mockCaseId = crypto.randomUUID();
      toast.error("OCR Failed to scan label. Let's enter details manually.");
      playAudio(`/audio/${lang}/ocr_failed_${lang}.mp3`);
      navigate({ to: "/manual", search: { caseId: mockCaseId } });
      return;
    }

    if (type === "AMBER_ESCALATE") {
      const mockCaseId = crypto.randomUUID();
      
      // Post to mock server to populate in-memory expert dashboard!
      try {
        await fetch("http://localhost:3001/api/v1/escalation/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: mockCaseId,
            device_id: getDeviceId(),
            ocr_tokens: ["UNKNOWN", "BAD_BATCH"],
            status: "PENDING",
          }),
        });
      } catch (e) {
        // Mock offline fallback
      }

      toast.success("Low confidence: Sent to Masumi agronomist queue!");
      playAudio(`/audio/${lang}/escalation_sent_${lang}.mp3`);
      
      saveScanToHistory({
        id: mockCaseId,
        brand_name: "Unknown Fertilizer (Pending)",
        risk_status: "AMBER",
        timestamp: new Date().toISOString(),
      });
      navigate({ to: "/result", search: { caseId: mockCaseId, status: "AMBER" } });
      return;
    }

    const matches = TOP_20_FERTILIZERS.filter((f) => f.risk_status === type);
    const profile = matches[Math.floor(Math.random() * matches.length)];
    
    const impact = type === "GREEN" ? 5 : -10;
    updateScore(impact);
    
    saveScanToHistory({
      id: profile.id,
      brand_name: profile.brand_name,
      risk_status: profile.risk_status,
      timestamp: new Date().toISOString(),
    });
    
    navigate({ to: "/result", search: { id: profile.id } });
  };

  // Voice recording simulation
  const handleStartRecording = () => {
    setIsRecording(true);
    playAudio(`/audio/${lang}/listening_${lang}.mp3`);
    
    setTimeout(() => {
      setIsRecording(false);
    }, 2500);
  };

  // Submit voice translation
  const handleVoiceSearch = (phrase: string) => {
    setShowVoiceModal(false);
    
    const cleanPhrase = phrase.toLowerCase();
    const match = TOP_20_FERTILIZERS.find((f) => 
      cleanPhrase.includes(f.brand_name.toLowerCase()) || 
      f.batch_prefix_keywords.some((kw) => cleanPhrase.includes(kw.toLowerCase()))
    );

    if (match) {
      toast.success(`Voice Recognized: "${match.brand_name}"`);
      const impact = match.risk_status === "GREEN" ? 5 : match.risk_status === "RED" ? -10 : 0;
      updateScore(impact);
      
      saveScanToHistory({
        id: match.id,
        brand_name: match.brand_name,
        risk_status: match.risk_status,
        timestamp: new Date().toISOString(),
      });
      
      navigate({ to: "/result", search: { id: match.id } });
    } else {
      const mockCaseId = crypto.randomUUID();
      toast.info("Unrecognized name: Escalating query to experts.");
      playAudio(`/audio/${lang}/escalation_sent_${lang}.mp3`);
      
      saveScanToHistory({
        id: mockCaseId,
        brand_name: `Voice Request ("${phrase}")`,
        risk_status: "AMBER",
        timestamp: new Date().toISOString(),
      });
      
      navigate({ to: "/result", search: { caseId: mockCaseId, status: "AMBER" } });
    }
  };

  const getVoicePresets = () => {
    switch (lang) {
      case "sw":
        return ["Nikitumia YaraMila?", "Nataka kuweka Mavuno Planting", "Je Bio Mazao ni salama?"];
      case "ki":
        return ["Hihi no njĩre YaraMila?", "Nĩngwenda kuuga Mavuno", "Bio Mazao nĩ njega?"];
      case "luo":
        return ["An nyalo tiyo gi YaraMila?", "Adwaro keto Mavuno", "Bio Mazao ber?"];
      case "kal":
        return ["Aa nyal aing'et YaraMila?", "Aa chame Mavuno", "Bio Mazao nee karar?"];
      default:
        return ["Is YaraMila safe?", "I want to use Mavuno Planting", "Is Bio Mazao organic okay?"];
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-6 py-2">
      {/* Help Instructions bar */}
      <button 
        onClick={handlePlayInstructions}
        className="w-full flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl active:scale-[0.99] transition-all text-left group"
      >
        <div className="flex items-center gap-2">
          <Volume2 className="text-emerald-600 dark:text-emerald-500 group-hover:scale-110 transition-transform" size={18} />
          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400">
            {t(lang, "listen")} (Kiswahili/Vernacular Guide)
          </span>
        </div>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-500 font-bold bg-white dark:bg-zinc-800 border border-emerald-200 dark:border-emerald-900 px-2 py-0.5 rounded-full">
          PLAY
        </span>
      </button>

      {/* Export Score Card */}
      <div className="bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="text-emerald-600 dark:text-emerald-500" size={20} />
            <h3 className="font-bold text-sm text-slate-800 dark:text-zinc-200 uppercase tracking-wide">
              {t(lang, "score")}
            </h3>
          </div>
          <HelpCircle 
            className="text-slate-400 hover:text-slate-500 cursor-pointer" 
            size={18} 
            onClick={() => toast.info("SACCOs use this score to evaluate your farming credit. Safe fertilizer usage boosts your score!")}
          />
        </div>

        {/* Progress Bar & Number */}
        <div className="flex items-center gap-5">
          <div className="relative flex items-center justify-center h-20 w-20 flex-shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="34"
                className="stroke-slate-100 dark:stroke-zinc-700"
                strokeWidth="7"
                fill="transparent"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                className="stroke-emerald-500 transition-all duration-500"
                strokeWidth="7"
                fill="transparent"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 * (1 - score / 100)}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-xl font-extrabold text-slate-800 dark:text-zinc-50">{score}</span>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-1">
              <TrendingUp size={14} className="text-emerald-500" />
              <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Export Readiness</span>
            </div>
            <p className={`text-sm font-extrabold mt-1 ${getScoreStatus().color}`}>
              {getScoreStatus().label}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 leading-normal">
              Score 80+ qualifies you for the SACCO agricultural credit scheme. Keep inputs compliant!
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid gap-4 mt-2">
        {/* Scan Label button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-28 flex flex-col items-center justify-center gap-2 p-5 bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-3xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all group duration-200"
        >
          <Camera size={32} className="group-hover:scale-110 transition-transform" />
          <span className="font-extrabold text-base tracking-wide">
            {t(lang, "scan")} (Camera)
          </span>
          <span className="text-[10px] text-emerald-100 font-medium">Verify logo & chemical composition</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Speak Name button */}
        <button
          onClick={() => setShowVoiceModal(true)}
          className="w-full h-28 flex flex-col items-center justify-center gap-2 p-5 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-3xl shadow-sm hover:shadow-md active:scale-[0.98] transition-all group duration-200 text-slate-800 dark:text-zinc-100"
        >
          <Mic size={32} className="text-emerald-600 dark:text-emerald-500 group-hover:scale-110 transition-transform" />
          <span className="font-extrabold text-base tracking-wide">
            {t(lang, "speak")} (Voice)
          </span>
          <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium">Sema kwa Kiswahili au lugha ya kienyeji</span>
        </button>

        {/* Manual Input link */}
        <Link
          to="/manual"
          className="w-full flex items-center justify-between p-4 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 border border-slate-200/50 dark:border-zinc-800 rounded-2xl active:scale-[0.99] transition-all text-slate-700 dark:text-zinc-300"
        >
          <div className="flex items-center gap-3">
            <Keyboard size={20} className="text-slate-500" />
            <span className="font-bold text-sm">{t(lang, "manual")} (Offline Fallback)</span>
          </div>
          <span className="text-xs text-slate-400">Step-by-step visual selector &rarr;</span>
        </Link>
      </div>

      {/* Recent Scans History */}
      <div className="mt-4 flex-1">
        <div className="flex items-center gap-2 mb-3">
          <History size={16} className="text-slate-400" />
          <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Recent Scans
          </h4>
        </div>

        {history.length === 0 ? (
          <div className="text-center p-8 bg-slate-100/50 dark:bg-zinc-800/20 border border-dashed border-slate-200 dark:border-zinc-800 rounded-3xl">
            <p className="text-xs text-slate-400 dark:text-zinc-500">No fertilizers checked yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, index) => (
              <Link
                key={index}
                to="/result"
                search={
                  item.risk_status === "AMBER" && item.id.includes("-")
                    ? { caseId: item.id, status: "AMBER" }
                    : { id: item.id }
                }
                className="flex items-center justify-between p-3.5 bg-white dark:bg-zinc-800 border border-slate-200/60 dark:border-zinc-700/60 rounded-2xl hover:border-emerald-500 dark:hover:border-emerald-500 cursor-pointer shadow-sm active:scale-[0.99] transition-all duration-150 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    item.risk_status === "GREEN" ? "bg-emerald-500" :
                    item.risk_status === "RED" ? "bg-rose-500" : "bg-amber-500 animate-pulse"
                  }`} />
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 dark:text-zinc-200">{item.brand_name}</h5>
                    <p className="text-[9px] text-slate-400 mt-0.5">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">&rarr;</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Voice Recording Modal */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-zinc-700 shadow-2xl relative animate-fadeIn">
            <button 
              onClick={() => setShowVoiceModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-400"
            >
              <X size={18} />
            </button>

            <h3 className="font-extrabold text-lg text-center mt-2 text-slate-900 dark:text-zinc-50">
              {t(lang, "speak")} (Featherless AI Voice)
            </h3>
            
            <p className="text-center text-xs text-slate-500 dark:text-zinc-400 mt-2">
              Speak fertilizer name or say: "Je [chapa] iko salama?"
            </p>

            <div className="my-8 flex flex-col items-center justify-center">
              {isRecording ? (
                <div className="h-16 flex items-center gap-1.5 justify-center mb-4">
                  {[...Array(6)].map((_, i) => (
                    <span 
                      key={i} 
                      className="w-1.5 bg-emerald-500 rounded-full animate-bounce"
                      style={{ 
                        height: `${[24, 48, 36, 52, 28, 42][i]}px`, 
                        animationDelay: `${i * 0.1}s`,
                        animationDuration: "0.6s"
                      }}
                    />
                  ))}
                </div>
              ) : (
                <button
                  onClick={handleStartRecording}
                  className="h-20 w-20 rounded-full bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shadow-lg active:scale-95 transition-all mb-4"
                >
                  <Mic size={36} />
                </button>
              )}
              <span className="text-xs font-bold text-slate-400 dark:text-zinc-500">
                {isRecording ? "Listening... Speak now" : "Tap Microphone to Speak"}
              </span>
            </div>

            {/* Quick Presets */}
            <div className="space-y-2 mt-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                Or choose a preset command:
              </span>
              <div className="grid gap-2 max-h-48 overflow-y-auto pr-1">
                {getVoicePresets().map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleVoiceSearch(preset)}
                    className="w-full text-left p-2.5 text-xs bg-slate-50 hover:bg-slate-100 dark:bg-zinc-900/50 dark:hover:bg-zinc-900 rounded-xl border border-slate-100 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 active:scale-[0.99] transition-all flex items-center gap-2"
                  >
                    <Play size={10} className="text-emerald-500" />
                    <span>{preset}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Offline/Demo Scan Outcome Simulator */}
      {showScanSimulator && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-zinc-700 shadow-2xl relative animate-fadeIn">
            <button 
              onClick={() => setShowScanSimulator(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-400"
            >
              <X size={18} />
            </button>

            <h3 className="font-extrabold text-base text-slate-900 dark:text-zinc-50 flex items-center gap-2">
              <span>📸</span>
              <span>Camera Scan Simulator</span>
            </h3>
            
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-2 leading-relaxed">
              You are offline or the backend server is unreachable. Select a simulated scanning outcome to verify your UI styling:
            </p>

            <div className="space-y-2.5 mt-5">
              <button
                onClick={() => handleSimulateScanOutcome("GREEN")}
                className="w-full p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold text-left flex items-center justify-between active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                  <span>Simulate SAFE Fertilizer (GREEN)</span>
                </div>
                <span>+5 Score</span>
              </button>

              <button
                onClick={() => handleSimulateScanOutcome("RED")}
                className="w-full p-3.5 rounded-2xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold text-left flex items-center justify-between active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" />
                  <span>Simulate DANGEROUS Fertilizer (RED)</span>
                </div>
                <span>-10 Score</span>
              </button>

              <button
                onClick={() => handleSimulateScanOutcome("AMBER_ESCALATE")}
                className="w-full p-3.5 rounded-2xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold text-left flex items-center justify-between active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                  <span>Simulate Unknown/Escalate (AMBER)</span>
                </div>
                <span>0 Score</span>
              </button>

              <button
                onClick={() => handleSimulateScanOutcome("OCR_FAILED")}
                className="w-full p-3.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold text-left flex items-center justify-between active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-slate-400 rounded-full" />
                  <span>Simulate OCR Failure</span>
                </div>
                <span>Manual Form</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================
// EXPERT AGRONOMIST DASHBOARD COMPONENT
// ====================================================
function ExpertDashboard() {
  const [cases, setCases] = useState<EscalationCase[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Stats
  const [stats, setStats] = useState({ total: 0, pending: 0, resolved: 0 });
  
  // Review modal states
  const [activeCase, setActiveCase] = useState<EscalationCase | null>(null);
  const [verdict, setVerdict] = useState<"SAFE" | "UNSAFE">("SAFE");
  const [notes, setNotes] = useState("");

  const loadExpertData = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:3001/api/v1/expert/cases?status=ALL");
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases || []);
        
        // Calculate stats
        const allCases: EscalationCase[] = data.cases || [];
        const pending = allCases.filter(c => c.status === "PENDING").length;
        const resolved = allCases.filter(c => c.status === "RESOLVED").length;
        setStats({ total: allCases.length, pending, resolved });
      }
    } catch (e) {
      console.warn("Could not query expert cases from server, loading mocked data.", e);
      // Load mock items from history/localStorage escalations
      const savedHistory = localStorage.getItem("kilimo_scan_history");
      const historyList = savedHistory ? JSON.parse(savedHistory) : [];
      const simulatedCases = historyList
        .filter((item: any) => item.risk_status === "AMBER")
        .map((item: any) => ({
          case_id: item.id,
          device_id: "device-mock-123",
          brand_name: item.brand_name,
          ocr_tokens: ["SAMPLE", "BATCH"],
          status: "PENDING",
          created_at: item.timestamp,
        }));
      setCases(simulatedCases);
      setStats({ total: simulatedCases.length, pending: simulatedCases.length, resolved: 0 });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadExpertData();
  }, []);

  const handleOpenReview = (c: EscalationCase) => {
    setActiveCase(c);
    setVerdict("SAFE");
    setNotes("");
  };

  const handleSubmitVerdict = async () => {
    if (!activeCase) return;

    toast.info("Submitting expert agronomist verdict...");
    
    const payload = {
      verdict,
      notes: notes || `Mbolea hii imehakikiwa na kupatikana kuwa ${verdict === "SAFE" ? "SALAMA" : "HATARI"} kwa mazao ya kuuza nje ya nchi.`,
      safe_alternative_id: verdict === "UNSAFE" ? "mavuno_planting_04" : null
    };

    try {
      const res = await fetch(`http://localhost:3001/api/v1/expert/cases/${activeCase.case_id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        toast.success("Verdict successfully updated!");
        setActiveCase(null);
        loadExpertData();
      } else {
        throw new Error("Failed to post");
      }
    } catch (e) {
      // Mock local resolve
      toast.success("Verdict applied locally!");
      
      // Update local storage scan history for matches
      const savedHistory = localStorage.getItem("kilimo_scan_history");
      if (savedHistory) {
        const list = JSON.parse(savedHistory);
        const match = list.find((x: any) => x.id === activeCase.case_id);
        if (match) {
          match.risk_status = verdict === "SAFE" ? "GREEN" : "RED";
          match.brand_name = verdict === "SAFE" ? "Verified safe by Expert" : "Flagged unsafe by Expert";
          localStorage.setItem("kilimo_scan_history", JSON.stringify(list));
        }
      }
      
      setActiveCase(null);
      loadExpertData();
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-6 py-2">
      {/* Header and Back Link */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <UserCheck className="text-emerald-600 dark:text-emerald-500" size={20} />
          <h3 className="font-extrabold text-base text-slate-800 dark:text-zinc-100">
            Expert Review Dashboard
          </h3>
        </div>
        <Link
          to="/home"
          search={{ expertView: undefined }}
          className="text-xs font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1 bg-slate-100 dark:bg-zinc-850 px-3 py-1.5 rounded-xl active:scale-95 transition-all"
        >
          <ArrowLeft size={12} />
          <span>Farmer View</span>
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-zinc-800 border border-slate-200/60 dark:border-zinc-700 p-3.5 rounded-2xl text-center shadow-xs">
          <span className="block text-[10px] uppercase font-bold text-slate-400">Total Cases</span>
          <span className="text-lg font-black text-slate-800 dark:text-zinc-100 mt-1 block">{stats.total}</span>
        </div>
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 p-3.5 rounded-2xl text-center shadow-xs">
          <span className="block text-[10px] uppercase font-bold text-amber-600 dark:text-amber-500">Pending</span>
          <span className="text-lg font-black text-amber-600 dark:text-amber-400 mt-1 block">{stats.pending}</span>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/10 border border-emerald-100/40 dark:border-emerald-900/30 p-3.5 rounded-2xl text-center shadow-xs">
          <span className="block text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-500">Resolved</span>
          <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1 block">{stats.resolved}</span>
        </div>
      </div>

      {/* Cases List */}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-3.5">
          <ClipboardList size={15} className="text-slate-400" />
          <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Escalation Inbox
          </h4>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <RefreshCw className="animate-spin text-emerald-500" size={24} />
          </div>
        ) : cases.length === 0 ? (
          <div className="text-center p-12 bg-white dark:bg-zinc-800 border border-slate-200/50 dark:border-zinc-700/50 rounded-3xl">
            <FileCheck className="mx-auto mb-2 text-slate-350" size={32} />
            <p className="text-xs text-slate-400 dark:text-zinc-500">All compliance cases resolved!</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {cases.map((c) => (
              <div
                key={c.case_id}
                className="p-4 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-750 rounded-2xl shadow-xs flex flex-col gap-3"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 dark:text-zinc-200 truncate max-w-[200px]">
                      {c.brand_name || "Unknown Label Scan"}
                    </h5>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      Case: {c.case_id.slice(0, 8)}... &bull; {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                    c.status === "PENDING"
                      ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 animate-pulse"
                      : "bg-slate-100 dark:bg-zinc-900 text-slate-400"
                  }`}>
                    {c.status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2.5 border-t border-slate-100 dark:border-zinc-750">
                  <span className="font-mono">ID: {c.device_id.slice(0, 6)}...</span>
                  {c.status === "PENDING" ? (
                    <button
                      onClick={() => handleOpenReview(c)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg active:scale-95 transition-all text-[10px]"
                    >
                      Review Case &rarr;
                    </button>
                  ) : (
                    <span className="text-emerald-500 font-bold">Resolved</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review Verdict Dialog */}
      {activeCase && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-zinc-700 shadow-2xl relative animate-fadeIn">
            <button 
              onClick={() => setActiveCase(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-400"
            >
              <X size={18} />
            </button>

            <h3 className="font-extrabold text-base text-slate-800 dark:text-zinc-100 mb-1 flex items-center gap-1.5">
              <span>🧑‍🔬</span>
              <span>Submit Agronomist Verdict</span>
            </h3>
            <p className="text-[10px] text-slate-400 mb-4 font-mono">Case ID: {activeCase.case_id}</p>

            <div className="space-y-4">
              {/* Verdict Selection */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Verdict</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setVerdict("SAFE")}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                      verdict === "SAFE"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/10"
                        : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <Check size={14} />
                    <span>SAFE (GREEN)</span>
                  </button>

                  <button
                    onClick={() => setVerdict("UNSAFE")}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                      verdict === "UNSAFE"
                        ? "bg-rose-50 border-rose-500 text-rose-700 ring-2 ring-rose-500/10"
                        : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <AlertCircle size={14} />
                    <span>UNSAFE (RED)</span>
                  </button>
                </div>
              </div>

              {/* Notes Input */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Agronomist Advisory Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter chemical validation findings and plain-language advisory details..."
                  className="w-full h-24 p-3 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs bg-slate-50 dark:bg-zinc-900 focus:outline-emerald-500"
                />
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmitVerdict}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-md active:scale-95 transition-all mt-2"
              >
                Submit Verdict & Notify Farmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
