import { useState, useEffect, useRef, useCallback } from "react";
import { X, Minus, Equal } from "lucide-react";

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
  const [visible, setVisible] = useState(() => {
    const k = `joap_calc_${username}`;
    return localStorage.getItem(k) !== "false";
  });
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<CalcOp>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [memory, setMemory] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const dragStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });
  const calcRef = useRef<HTMLDivElement>(null);

  // Initialize position bottom-right
  useEffect(() => {
    setPos({ x: window.innerWidth - 240, y: window.innerHeight - 380 });
    setInitialized(true);
  }, []);

  // Listen for toggle events from settings page
  useEffect(() => {
    function handleToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      setVisible(detail?.enabled ?? true);
    }
    window.addEventListener("joap-calc-toggle", handleToggle);
    return () => window.removeEventListener("joap-calc-toggle", handleToggle);
  }, []);

  // Dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, cx: pos.x, cy: pos.y };
  }, [pos]);

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      const newX = Math.max(0, Math.min(window.innerWidth - 220, dragStart.current.cx + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 360, dragStart.current.cy + dy));
      setPos({ x: newX, y: newY });
    }
    function onUp() { setIsDragging(false); }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  function inputDigit(digit: string) {
    if (waitingForOperand) {
      setDisplay(digit === "." ? "0." : digit);
      setWaitingForOperand(false);
    } else {
      if (digit === "." && display.includes(".")) return;
      setDisplay(display === "0" && digit !== "." ? digit : display + digit);
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
    if (prev !== null && op) {
      setDisplay(String((prev * val) / 100));
    } else {
      setDisplay(String(val / 100));
    }
    setWaitingForOperand(true);
  }

  function handleSign() {
    const val = parseFloat(display);
    setDisplay(String(-val));
  }

  function handleAC() {
    setDisplay("0");
    setPrev(null);
    setOp(null);
    setWaitingForOperand(false);
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
    const base = "flex items-center justify-center rounded-xl text-sm font-semibold cursor-pointer select-none transition-all duration-75 active:scale-95 h-10";
    if (label === "0") return `${base} col-span-2 px-4 justify-start`;
    if (["÷", "×", "−", "+", "="].includes(label)) {
      return `${base} bg-primary text-primary-foreground hover:bg-primary/90`;
    }
    if (["AC", "±", "%"].includes(label)) {
      return `${base} bg-muted text-foreground hover:bg-muted/70`;
    }
    return `${base} bg-card text-foreground hover:bg-accent border border-border`;
  }

  if (!initialized || !visible) return null;

  const currentVal = parseFloat(display);
  const memStr = memory !== 0 ? `M: ${memory}` : "";

  return (
    <div
      ref={calcRef}
      className="fixed z-[9999] select-none"
      style={{ left: pos.x, top: pos.y, width: 220 }}
    >
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-border/60 bg-background/95 backdrop-blur-sm">
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-muted/80 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
        >
          <span className="text-xs font-semibold text-muted-foreground tracking-wide">CALCULATOR</span>
          <div className="flex items-center gap-1">
            {memStr && <span className="text-[9px] text-primary font-medium">{memStr}</span>}
            <button
              className="w-4 h-4 rounded-full bg-muted-foreground/20 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
              onClick={() => setVisible(false)}
              title="Close calculator"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Display */}
        <div className="px-3 py-3 bg-muted/40 text-right">
          {op && (
            <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-end gap-1">
              <span className="font-mono">{prev}</span>
              <span className="text-primary font-bold">{op}</span>
            </div>
          )}
          <div
            className="font-mono font-bold tracking-tight text-foreground leading-none"
            style={{ fontSize: display.length > 9 ? "16px" : display.length > 6 ? "20px" : "28px" }}
            data-testid="calc-display"
          >
            {formatDisplay(display)}
          </div>
        </div>

        {/* Buttons */}
        <div className="p-2 space-y-1.5">
          {BUTTONS.map((row, ri) => (
            <div
              key={ri}
              className={`grid gap-1.5 ${row.length === 4 ? "grid-cols-4" : "grid-cols-4"}`}
            >
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
          <div className="grid grid-cols-4 gap-1.5 pt-0.5 border-t border-border/30">
            {["MC", "MR", "M+", "M−"].map((label) => (
              <button
                key={label}
                className="flex items-center justify-center rounded-xl text-[10px] font-semibold cursor-pointer select-none transition-all active:scale-95 h-7 bg-muted/60 text-muted-foreground hover:bg-muted"
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
