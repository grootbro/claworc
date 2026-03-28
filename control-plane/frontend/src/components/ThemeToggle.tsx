import { MoonStar, SunMedium } from "lucide-react";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";

const options: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof SunMedium;
}> = [
  { mode: "light", label: "Light theme", icon: SunMedium },
  { mode: "dark", label: "Dark theme", icon: MoonStar },
];

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="theme-toggle-shell" aria-label="Theme switcher" role="group">
      {options.map(({ mode: optionMode, label, icon: Icon }) => {
        const active = mode === optionMode;
        return (
          <button
            key={optionMode}
            type="button"
            onClick={() => setMode(optionMode)}
            className="theme-toggle-option"
            data-active={active}
            title={label}
            aria-label={label}
            aria-pressed={active}
          >
            <Icon size={13} className="shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
