import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";

const options: Array<{
  mode: ThemeMode;
  label: string;
  shortLabel: string;
  icon: typeof SunMedium;
}> = [
  { mode: "light", label: "Light", shortLabel: "Light", icon: SunMedium },
  { mode: "dark", label: "Dark", shortLabel: "Dark", icon: MoonStar },
  { mode: "system", label: "Auto", shortLabel: "Auto", icon: LaptopMinimal },
];

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      className={`theme-toggle-shell ${compact ? "theme-toggle-shell--compact" : ""}`}
      aria-label="Theme switcher"
      role="group"
    >
      {options.map(({ mode: optionMode, label, shortLabel, icon: Icon }) => {
        const active = mode === optionMode;
        return (
          <button
            key={optionMode}
            type="button"
            onClick={() => setMode(optionMode)}
            className="theme-toggle-option"
            data-active={active}
            title={label}
            aria-pressed={active}
          >
            <Icon size={15} className="shrink-0" />
            <span>{compact ? shortLabel : label}</span>
          </button>
        );
      })}
    </div>
  );
}
