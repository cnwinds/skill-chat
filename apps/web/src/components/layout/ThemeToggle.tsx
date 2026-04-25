import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ThemeToggleProps {
  themeMode: 'light' | 'dark';
  onToggle: () => void;
}

export const ThemeToggle = ({ themeMode, onToggle }: ThemeToggleProps) => {
  const label = themeMode === 'dark' ? '浅色' : '深色';
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      {themeMode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
};

export default ThemeToggle;
