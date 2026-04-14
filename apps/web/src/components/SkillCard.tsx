import type { SkillMetadata } from '@skillchat/shared';
import { cn } from '../lib/utils';

type SkillCardProps = {
  skill: SkillMetadata;
  selected?: boolean;
  disabled?: boolean;
  onToggle?: (() => void) | undefined;
};

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 5v14M5 12h14"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
    />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="m6.5 12.5 3.6 3.6L17.5 8.7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
    />
  </svg>
);

const InstalledIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M7 10.5 12 7l5 3.5v6L12 20l-5-3.5v-6Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    />
    <path
      d="M12 7v13"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    />
  </svg>
);

export const SkillCard = ({
  skill,
  selected = false,
  disabled = false,
  onToggle,
}: SkillCardProps) => {
  const isToggleable = typeof onToggle === 'function';
  const buttonLabel = selected ? `本会话已启用：${skill.name}` : `加入会话：${skill.name}`;
  const installedLabel = `${skill.name} 已安装`;

  return (
    <article className={cn('skill-card', selected && 'is-selected', isToggleable && 'is-toggleable')}>
      <div className="skill-card-header">
        <div className="skill-card-heading">
          <div className="skill-title">{skill.name}</div>
        </div>
        {isToggleable ? (
          <button
            type="button"
            className={cn('skill-card-icon-button', selected && 'is-selected')}
            disabled={disabled}
            onClick={onToggle}
            aria-label={buttonLabel}
            title={buttonLabel}
          >
            {selected ? <CheckIcon /> : <PlusIcon />}
          </button>
        ) : (
          <span className="skill-card-installed-badge" title={installedLabel} aria-label={installedLabel}>
            <InstalledIcon />
          </span>
        )}
      </div>

      <div className="skill-card-body">
        <p className="skill-card-description">{skill.description}</p>
      </div>

      <div className="skill-card-popover" role="tooltip">
        <div className="skill-card-popover-header">
          <div className="skill-title">{skill.name}</div>
        </div>
        <p className="skill-card-popover-text">{skill.description}</p>
      </div>
    </article>
  );
};
