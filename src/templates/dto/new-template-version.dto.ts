import { ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateTaskInputDto } from './template-task-input.dto';

/**
 * "Editing" a template means: supply the full desired task list here.
 * The service inserts it as a brand-new onboarding_templates row
 * (version + 1) with its own fresh template_tasks rows. Nothing about
 * the previous version is altered — it just stops being the active
 * one offered to new joiners. Onboardings already instantiated from
 * the old version keep pointing at it (informationally) and are
 * completely unaffected either way, since they never read from
 * template_tasks live in the first place.
 */
export class NewTemplateVersionDto {
  @ValidateNested({ each: true })
  @Type(() => TemplateTaskInputDto)
  @ArrayMinSize(1)
  tasks!: TemplateTaskInputDto[];
}
