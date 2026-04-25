import type { FormEvent, ReactNode } from 'react';

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
  <div className="auth-page">
    <div className="auth-backdrop" />
    <form className="auth-card" onSubmit={onSubmit}>
      <div className="eyebrow">Skill Driven Workspace</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div className="auth-fields">
        {fields.map((field) => (
          <label key={field.name} className="field-group">
            <span>{field.label}</span>
            <input
              name={field.name}
              type={field.type ?? 'text'}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              autoComplete={field.name}
            />
          </label>
        ))}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button type="submit" className="primary-button" disabled={loading}>
        {loading ? '提交中...' : submitText}
      </button>
      <div className="auth-footer">{footer}</div>
    </form>
  </div>
);
