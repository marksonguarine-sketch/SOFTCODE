import { useState, useEffect, useRef, useCallback } from "react";
import { X, Calculator as CalcIcon } from "lucide-react";

interface FloatingCalculatorProps {
  username: string;
}

type CalcOp = "+" | "-" | "×" | "÷" | "%" | null;

const BUTTONS = [
  ["AC", "±", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "="],
];

function formatDisplay(val: string): string {
  if (val.length > 12) return parseFloat(val).toExponential(4);
  return val;
}

export function FloatingCalculator({ username }: FloatingCalculatorProps) {
  const [enabled, setEnabled] = useState(() => {
    const k = `joap_calc_${username}`;
    return localStorage.getItem(k) !== "false";
  });
  const [expanded, setExpanded] = useState(false);
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<CalcOp>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [memory, setMemory] = useState(0);
  const calcRef = useRef<HTMLDivElement>(null);

  // Listen for settings page toggle
  useEffect(() => {
    function handleToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      const isEnabled = detail?.enabled !== undefined ? detail.enabled : detail;
      setEnabled(typeof isEnabled === "boolean" ? isEnabled : true);
      if (!isEnabled) setExpanded(false);
    }
    window.addEventListener("joap-calc-toggle", handleToggle);
    return () => window.removeEventListener("joap-calc-toggle", handleToggle);
  }, []);

  // Keyboard support when calculator is expanded
  useEffect(() => {
    if (!expanded) return;
    function handleKey(e: KeyboardEvent) {
      // Don't steal keys from inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key;
      if (k >= "0" && k <= "9") { e.preventDefault(); inputDigit(k); }
      else if (k === ".") { e.preventDefault(); inputDigit("."); }
      else if (k === "+") { e.preventDefault(); handleOperator("+"); }
      else if (k === "-") { e.preventDefault(); handleOperator("-"); }
      else if (k === "*") { e.preventDefault(); handleOperator("×"); }
      else if (k === "/") { e.preventDefault(); handleOperator("÷"); }
      else if (k === "%" ) { e.preventDefault(); handlePercent(); }
      else if (k === "Enter" || k === "=") { e.preventDefault(); handleEqual(); }
      else if (k === "Backspace") { e.preventDefault(); handleBackspace(); }
      else if (k === "Escape") { e.preventDefault(); setExpanded(false); }
      else if (k.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handleAC(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, display, prev, op, waitingForOperand]);

  function inputDigit(digit: string) {
    if (waitingForOperand) {
      setDisplay(digit === "." ? "0." : digit);
      setWaitingForOperand(false);
    } else {
      if (digit === "." && display.includes(".")) return;
      setDisplay(display === "0" && digit !== "." ? digit : display + digit);
    }
  }

  function handleBackspace() {
    if (waitingForOperand) return;
    if (display.length <= 1 || (display.length === 2 && display[0] === "-")) {
      setDisplay("0");
    } else {
      setDisplay(display.slice(0, -1));
    }
  }

  function handleOperator(nextOp: "+" | "-" | "×" | "÷") {
    const input = parseFloat(display);
    if (prev !== null && op && !waitingForOperand) {
      const result = compute(prev, input, op);
      setDisplay(formatDisplay(String(result)));
      setPrev(result);
    } else {
      setPrev(input);
    }
    setOp(nextOp);
    setWaitingForOperand(true);
  }

  function compute(a: number, b: number, operation: CalcOp): number {
    switch (operation) {
      case "+": return a + b;
      case "-": return a - b;
      case "×": return a * b;
      case "÷": return b !== 0 ? a / b : 0;
      default: return b;
    }
  }

  function handleEqual() {
    const input = parseFloat(display);
    if (prev !== null && op) {
      const result = compute(prev, input, op);
      const str = Number.isFinite(result) ? String(parseFloat(result.toPrecision(12))) : "Error";
      setDisplay(str);
      setPrev(null);
      setOp(null);
      setWaitingForOperand(true);
    }
  }

  function handlePercent() {
    const val = parseFloat(display);
    if (prev !== null && op) setDisplay(String((prev * val) / 100));
    else setDisplay(String(val / 100));
    setWaitingForOperand(true);
  }

  function handleSign() { setDisplay(String(-parseFloat(display))); }

  function handleAC() {
    setDisplay("0"); setPrev(null); setOp(null); setWaitingForOperand(false);
  }

  function handleButton(label: string) {
    switch (label) {
      case "AC": handleAC(); break;
      case "±": handleSign(); break;
      case "%": handlePercent(); break;
      case "÷": handleOperator("÷"); break;
      case "×": handleOperator("×"); break;
      case "−": handleOperator("-"); break;
      case "+": handleOperator("+"); break;
      case "=": handleEqual(); break;
      case ".": inputDigit("."); break;
      default: inputDigit(label); break;
    }
  }

  function btnClass(label: string): string {
    const base = "flex items-center justify-center rounded-xl text-sm font-semibold cursor-pointer select-none transition-all duration-75 active:scale-95 h-11 shadow-sm";
    if (label === "0") return `${base} col-span-2 px-4 justify-start bg-card dark:bg-zinc-800 text-foreground hover:bg-accent border border-border`;
    if (["÷", "×", "−", "+", "="].includes(label)) return `${base} bg-primary text-primary-foreground hover:brightness-110 shadow-md`;
    if (["AC", "±", "%"].includes(label)) return `${base} bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-600`;
    return `${base} bg-card dark:bg-zinc-800 text-foreground hover:bg-accent border border-border`;
  }

  if (!enabled) return null;

  // ─── BUBBLE MODE ────────────────────────────────────────────
  if (!expanded) {
    return (
      <button
        ref={calcRef as any}
        className="fixed z-[9999] bottom-6 right-6 w-12 h-12 rounded-full shadow-2xl bg-primary text-primary-foreground flex items-center justify-center hover:scale-110 transition-all duration-150 ring-2 ring-background"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(true)}
        title="Open calculator (keyboard shortcut: numbers work when open)"
        data-testid="calc-bubble"
      >
        <CalcIcon className="h-5 w-5" />
      </button>
    );
  }

  // ─── EXPANDED MODE ──────────────────────────────────────────
  const memStr = memory !== 0 ? `M: ${memory}` : "";

  return (
    <div
      ref={calcRef}
      className="fixed z-[9999] bottom-6 right-6 select-none"
      style={{ width: 240 }}
    >
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-border/60 bg-background/98 backdrop-blur-sm">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-primary/10 to-primary/5 border-b border-border/40">
          <div className="flex items-center gap-2">
            <CalcIcon className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">Calculator</span>
          </div>
          <div className="flex items-center gap-2">
            {memStr && <span className="text-[9px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">{memStr}</span>}
            <button
              className="w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
              onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
              title="Close (Esc)"
              data-testid="calc-close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Display */}
        <div className="px-4 py-4 bg-gradient-to-b from-muted/60 to-muted/30">
          {op && (
            <div className="text-[10px] text-muted-foreground mb-1 flex items-center justify-end gap-1.5">
              <span className="font-mono opacity-70">{prev}</span>
              <span className="text-primary font-bold text-sm">{op}</span>
            </div>
          )}
          <div
            className="font-mono font-bold tracking-tight text-foreground leading-none text-right"
            style={{ fontSize: display.length > 9 ? "17px" : display.length > 6 ? "22px" : "30px" }}
            data-testid="calc-display"
          >
            {formatDisplay(display)}
          </div>
          <div className="text-[9px] text-muted-foreground/60 text-right mt-1">
            keyboard ready · ⌫ backspace · ESC close
          </div>
        </div>

        {/* Buttons */}
        <div className="p-2.5 space-y-1.5 bg-muted/20">
          {BUTTONS.map((row, ri) => (
            <div key={ri} className="grid gap-1.5 grid-cols-4">
              {row.map((label) => (
                <button
                  key={label}
                  className={btnClass(label)}
                  onClick={() => handleButton(label)}
                  data-testid={`calc-btn-${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}

          {/* Memory row */}
          <div className="grid grid-cols-4 gap-1.5 pt-0.5 border-t border-border/40 mt-1">
            {["MC", "MR", "M+", "M−"].map((label) => (
              <button
                key={label}
                className="flex items-center justify-center rounded-lg text-[10px] font-bold cursor-pointer select-none transition-all active:scale-95 h-7 bg-muted/60 text-muted-foreground hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/20"
                onClick={() => {
                  const val = parseFloat(display);
                  if (label === "MC") setMemory(0);
                  else if (label === "MR") { setDisplay(String(memory)); setWaitingForOperand(false); }
                  else if (label === "M+") setMemory((m) => m + val);
                  else if (label === "M−") setMemory((m) => m - val);
                }}
                data-testid={`calc-btn-${label}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
