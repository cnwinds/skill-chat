import type { SkillMetadata } from '@skillchat/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SkillCard } from '@/components/inspector/SkillCard';

export interface NewSessionDialogProps {
  open: boolean;
  title: string;
  selectedSkills: string[];
  skills: SkillMetadata[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onTitleChange: (value: string) => void;
  onToggleSkill: (skillName: string) => void;
  onSubmit: () => void;
}

export const NewSessionDialog = ({
  open,
  title,
  selectedSkills,
  skills,
  loading,
  onOpenChange,
  onTitleChange,
  onToggleSkill,
  onSubmit,
}: NewSessionDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>新建会话</DialogTitle>
        <DialogDescription>
          项目里可以安装很多 skill，但只有你现在选中的这些，才会进入本会话上下文并允许调用。
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-foreground-muted">会话标题</span>
          <Input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="可选，不填则自动使用“新会话”"
          />
        </label>

        <div className="flex flex-col gap-2">
          <div>
            <div className="text-sm font-medium">为当前会话选择可用 Skills</div>
            <div className="text-xs text-foreground-muted">
              未选择的 skill 不会进入模型上下文，也不允许读取或执行。
            </div>
          </div>
          <ScrollArea className="max-h-[280px] pr-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  selected={selectedSkills.includes(skill.name)}
                  onToggle={() => onToggleSkill(skill.name)}
                />
              ))}
              {skills.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-6 text-xs text-foreground-muted">
                  项目中还没有可选的 skill。
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter className="items-center justify-between sm:justify-between">
        <div className="text-xs text-foreground-muted">
          {selectedSkills.length > 0
            ? `本次会话已选择：${selectedSkills.join(' · ')}`
            : '本次会话未启用任何 skill，将按普通对话和通用工具运行。'}
        </div>
        <Button onClick={onSubmit} disabled={loading}>
          {loading ? '创建中...' : '创建会话'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default NewSessionDialog;
