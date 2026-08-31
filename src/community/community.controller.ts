import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommunityService } from './community.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CastVoteDto } from './dto/cast-vote.dto';
import { DeletePostDto } from './dto/delete-post.dto';
import { DeleteCommentDto } from './dto/delete-comment.dto';
import { parsePagination } from '../common/list-query.util';

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
    return this.communityService.createPost(actor.id, dto.body, dto.isQuestion);
  }

  // Step 33: limit/offset pagination.
  @UseGuards(JwtAuthGuard)
  @Get()
  listPosts(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.communityService.listPosts(actor.id, parsePagination({ limit, offset }));
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

  // Step 30: SuperAdmin/HR only, unlike every other route on this
  // controller. Acts purely on the post id — CommunityService.
  // deletePost never reads or reveals who wrote it, even to the admin
  // performing the moderation.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Delete(':id')
  @HttpCode(204)
  async deletePost(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeletePostDto,
  ) {
    await this.communityService.deletePost(id, actor.id, dto.reason);
  }

  // Same moderation privilege as deletePost, scoped to one comment
  // instead of the whole post.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Delete(':postId/comments/:commentId')
  @HttpCode(204)
  async deleteComment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: DeleteCommentDto,
  ) {
    await this.communityService.deleteComment(commentId, actor.id, dto.reason);
  }
}
