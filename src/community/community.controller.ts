import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommunityService } from './community.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CastVoteDto } from './dto/cast-vote.dto';

// No @Roles() anywhere here — community is open to every authenticated
// role (employees, task owners, HR/SuperAdmin all share the same
// board). The one real access rule this module enforces (author
// anonymity to non-authors) isn't role-shaped at all — see
// CommunityService.
@Controller('community/posts')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  createPost(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreatePostDto) {
    return this.communityService.createPost(actor.id, dto.body);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  listPosts(@CurrentUser() actor: AuthenticatedUser) {
    return this.communityService.listPosts(actor.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getPost(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.communityService.getPostWithComments(id, actor.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/comments')
  addComment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.communityService.addComment(id, actor.id, dto.body);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/vote')
  vote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CastVoteDto,
  ) {
    return this.communityService.castVote(id, actor.id, dto.value);
  }
}
