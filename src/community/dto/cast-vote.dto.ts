import { IsIn } from 'class-validator';

export class CastVoteDto {
  @IsIn([1, -1])
  value!: 1 | -1;
}
