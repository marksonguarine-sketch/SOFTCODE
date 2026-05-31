/**
 * NumberInput — number field with no leading-zero ugliness.
 *
 * Why this exists:
 *   <Input type="number" value={state} onChange=...> with state defaulting to
 *   0 produces "022" when the user types "22" (the leading 0 from state stays
 *   put because React-controlled inputs only set what they're told). This
 *   component keeps an *internal string draft* while the user types and only
 *   commits a real number to the parent on blur (or on debounced commit).
 *
 * Behaviour:
 *   • Renders empty string when value is 0/undefined/null so the placeholder
 *     shows ("Enter price" etc).
 *   • Strips leading zeros while typing ("0" → "", "022" → "22").
 *   • Accepts negative + decimal if allowDecimal/allowNegative are true.
 *   • Calls onChange(number) on every valid keystroke so React Hook Form
 *     validation stays live — but never feeds back the leading zero.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue"> & {
  value: number | undefined | null;
  onChange: (n: number) => void;
  /** Allow a decimal point (otherwise integer only). Defaults true. */
  allowDecimal?: boolean;
  /** Allow negative numbers. Defaults false. */
  allowNegative?: boolean;
  /** Min value clamp (only enforced on blur). */
  min?: number;
  /** Max value clamp (only enforced on blur). */
  max?: number;
};

function strip(s: string, allowDecimal: boolean, allowNegative: boolean): string {
  let v = s.replace(/[^\d.\-]/g, "");
  if (!allowDecimal) v = v.replace(/\./g, "");
  if (!allowNegative) v = v.replace(/-/g, "");
  // collapse repeats
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  }
  // allow a leading - but only once
  v = v.replace(/(?!^)-/g, "");
  // strip leading zeros: "022" → "22", "0" → "", "0.5" → "0.5"
  if (/^0\d/.test(v)) v = v.replace(/^0+/, "");
  if (v === "0") v = "";
  return v;
}

export const NumberInput = React.forwardRef<HTMLInputElement, Props>(function NumberInput(
  { value, onChange, allowDecimal = true, allowNegative = false, min, max, className, placeholder, ...rest },
  ref,
) {
  // Internal text draft so we can render an empty string when the parent's
  // numeric value is 0 (or null) — without that, the input would always
  // display "0" and break the no-leading-zero rule.
  const [text, setText] = React.useState<string>(() =>
    value === undefined || value === null || value === 0 ? "" : String(value),
  );

  // Re-sync if the parent overwrites the value from somewhere else (e.g.
  // form reset). Only update the visible text when the parent's number is
  // genuinely different from what our draft parses to.
  React.useEffect(() => {
    const parsed = text === "" ? 0 : Number(text);
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(value === undefined || value === null || value === 0 ? "" : String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      ref={ref}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      pattern={allowDecimal ? "[0-9.]*" : "[0-9]*"}
      placeholder={placeholder ?? "Enter a number"}
      className={cn(className)}
      value={text}
      onChange={(e) => {
        const next = strip(e.target.value, allowDecimal, allowNegative);
        setText(next);
        const asNum = next === "" || next === "-" || next === "." ? 0 : Number(next);
        if (Number.isFinite(asNum)) onChange(asNum);
      }}
      onBlur={(e) => {
        // On blur, clamp to min/max and re-render the text from the number.
        let n = text === "" ? 0 : Number(text);
        if (!Number.isFinite(n)) n = 0;
        if (typeof min === "number" && n < min) n = min;
        if (typeof max === "number" && n > max) n = max;
        setText(n === 0 ? "" : String(n));
        onChange(n);
        rest.onBlur?.(e);
      }}
      {...rest}
    />
  );
});
