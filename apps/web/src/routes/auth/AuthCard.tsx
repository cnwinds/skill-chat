import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface AuthCardField {
  name: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}

export interface AuthCardProps {
  title: string;
  subtitle: string;
  fields: AuthCardField[];
  submitText: string;
  onSubmit: (event: FormEvent) => void;
  footer: ReactNode;
  error: string | null;
  loading: boolean;
}

export const AuthCard = ({
  title,
  subtitle,
  fields,
  submitText,
  onSubmit,
  footer,
  error,
  loading,
}: AuthCardProps) => (
  <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <div className="flex flex-col gap-1.5">
        <div className="text-2xs uppercase tracking-wider text-foreground-muted">
          Skill Driven Workspace
        </div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-foreground-muted">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs text-foreground-muted">{field.label}</span>
            <Input
              name={field.name}
              type={field.type ?? 'text'}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              autoComplete={field.name}
            />
          </label>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? '提交中...' : submitText}
      </Button>

      <div className="flex flex-col items-stretch gap-1.5 text-sm">{footer}</div>
    </form>
  </div>
);
